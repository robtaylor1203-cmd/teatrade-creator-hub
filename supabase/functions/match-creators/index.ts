import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { getServiceClient, getAuthUser } from '../_shared/supabase.ts';

/**
 * match-creators — Scoring engine that ranks creators against brand campaigns.
 *
 * Scoring formula (100 points max):
 *  - Badge overlap:     40 pts (proportion of required badges the creator holds)
 *  - Niche overlap:     25 pts (tea_niches match with brand's product categories)
 *  - Follower threshold: 15 pts (meets or exceeds min_followers from best campaign)
 *  - Engagement:        10 pts (meets or exceeds min_engagement)
 *  - Profile complete:  10 pts (profile_complete = true)
 */

serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const user = await getAuthUser(req);
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { brand_email } = await req.json();
    if (!brand_email) {
      return new Response(JSON.stringify({ error: 'brand_email required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const sb = getServiceClient();

    // 1. Get brand's active campaigns to understand what they're looking for
    const { data: campaigns } = await sb
      .from('campaigns')
      .select('required_badges, min_followers, min_engagement, tea_category, platforms')
      .eq('brand_name', brand_email)
      .in('status', ['active', 'escrow_locked']);

    // 2. Get brand profile for product category matching
    const { data: brandProfile } = await sb
      .from('brand_profiles')
      .select('product_categories')
      .eq('email', brand_email)
      .single();

    // Aggregate brand requirements
    const allRequiredBadges = new Set<string>();
    let maxMinFollowers = 0;
    let maxMinEngagement = 0;
    const allTeaCats = new Set<string>();

    (campaigns || []).forEach((c: any) => {
      (c.required_badges || []).forEach((b: string) => allRequiredBadges.add(b));
      if (c.min_followers && c.min_followers > maxMinFollowers) maxMinFollowers = c.min_followers;
      if (c.min_engagement && c.min_engagement > maxMinEngagement) maxMinEngagement = c.min_engagement;
      if (c.tea_category) allTeaCats.add(c.tea_category);
    });

    // Also include brand product categories for niche scoring
    (brandProfile?.product_categories || []).forEach((c: string) => allTeaCats.add(c));

    // 3. Get all verified, paid, profile-complete creators
    const { data: creators } = await sb
      .from('creators')
      .select('id, display_name, bio, location, tea_niches, content_types, showcase_links, profile_complete, quiz_score')
      .eq('is_verified', true)
      .eq('has_paid', true);

    if (!creators || creators.length === 0) {
      return new Response(JSON.stringify({ creators: [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 4. For each creator, get their badges and social stats
    const creatorIds = creators.map((c: any) => c.id);

    const { data: allBadges } = await sb
      .from('creator_badges')
      .select('creator_id, badges(badge_name, badge_key)')
      .in('creator_id', creatorIds);

    const { data: allSocials } = await sb
      .from('creator_socials')
      .select('creator_id, platform, follower_count, engagement_rate, avg_views, is_verified')
      .in('creator_id', creatorIds);

    // Build lookup maps
    const badgeMap = new Map<string, string[]>();
    (allBadges || []).forEach((b: any) => {
      const key = b.creator_id;
      if (!badgeMap.has(key)) badgeMap.set(key, []);
      // badge_key maps to the checkbox values used in campaigns (Chemistry, Terroir, etc.)
      const badgeName = b.badges?.badge_name || '';
      const shortKey = b.badges?.badge_key || '';
      // Campaign required_badges uses short names like "Chemistry", "Terroir"
      badgeMap.get(key)!.push(badgeName);
      // Also store the short key variant
      const keyMap: Record<string, string> = {
        'chemistry': 'Chemistry',
        'terroir': 'Terroir',
        'botanical': 'Botanical',
        'gongfu': 'Gongfu',
        'sourcing': 'Sourcing',
      };
      if (keyMap[shortKey]) {
        // Ensure we have the variant used in campaigns
        if (!badgeMap.get(key)!.includes(keyMap[shortKey])) {
          badgeMap.get(key)!.push(keyMap[shortKey]);
        }
      }
    });

    const socialMap = new Map<string, any>();
    (allSocials || []).forEach((s: any) => {
      const key = s.creator_id;
      // Keep highest follower count across platforms
      const existing = socialMap.get(key);
      if (!existing || (s.follower_count || 0) > (existing.follower_count || 0)) {
        socialMap.set(key, s);
      }
    });

    // 5. Score each creator
    const scored = creators.map((c: any) => {
      let score = 0;
      const creatorBadges = badgeMap.get(c.id) || [];
      const social = socialMap.get(c.id) || {};

      // Badge overlap (40 pts)
      if (allRequiredBadges.size > 0) {
        const matched = [...allRequiredBadges].filter(b =>
          creatorBadges.some(cb => cb.toLowerCase().includes(b.toLowerCase()))
        ).length;
        score += Math.round((matched / allRequiredBadges.size) * 40);
      } else {
        // No specific badge requirements — give partial credit for having badges
        score += Math.min(creatorBadges.length * 8, 40);
      }

      // Niche overlap (25 pts)
      const creatorNiches = c.tea_niches || [];
      if (allTeaCats.size > 0 && creatorNiches.length > 0) {
        const nicheMatch = creatorNiches.filter((n: string) => allTeaCats.has(n)).length;
        score += Math.round((nicheMatch / Math.max(allTeaCats.size, 1)) * 25);
      } else if (creatorNiches.length > 0) {
        score += 10; // Has niches filled out but no brand criteria to match against
      }

      // Follower threshold (15 pts)
      const followers = social.follower_count || 0;
      if (maxMinFollowers > 0) {
        if (followers >= maxMinFollowers) score += 15;
        else if (followers >= maxMinFollowers * 0.7) score += 10;
        else if (followers >= maxMinFollowers * 0.4) score += 5;
      } else {
        if (followers >= 10000) score += 15;
        else if (followers >= 5000) score += 10;
        else if (followers >= 1000) score += 5;
      }

      // Engagement (10 pts)
      const engRate = social.engagement_rate || 0;
      if (maxMinEngagement > 0) {
        if (engRate >= maxMinEngagement) score += 10;
        else if (engRate >= maxMinEngagement * 0.7) score += 6;
      } else {
        if (engRate >= 3) score += 10;
        else if (engRate >= 1.5) score += 6;
      }

      // Profile completeness (10 pts)
      if (c.profile_complete) score += 10;

      return {
        id: c.id,
        display_name: c.display_name,
        bio: c.bio,
        location: c.location,
        niches: c.tea_niches,
        content_types: c.content_types,
        showcase_links: c.showcase_links,
        badges: creatorBadges.filter((b: string) =>
          ['Chemistry', 'Terroir', 'Botanical', 'Gongfu', 'Sourcing'].some(k =>
            b.toLowerCase().includes(k.toLowerCase())
          )
        ).map((b: string) => {
          // Return clean short names for display
          if (b.includes('Chemistry')) return 'Chemistry';
          if (b.includes('Terroir')) return 'Terroir';
          if (b.includes('Botanical')) return 'Botanical';
          if (b.includes('Gongfu')) return 'Gongfu';
          if (b.includes('Sourcing')) return 'Sourcing';
          return b;
        }),
        followers: social.follower_count || 0,
        engagement_rate: social.engagement_rate || 0,
        avg_views: social.avg_views || 0,
        platform: social.platform || null,
        is_verified: social.is_verified ?? false,
        match_score: Math.min(score, 100),
      };
    });

    // Sort by score descending, return top 20
    scored.sort((a: any, b: any) => b.match_score - a.match_score);
    const top = scored.filter((c: any) => c.match_score > 0).slice(0, 20);

    return new Response(JSON.stringify({ creators: top }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
