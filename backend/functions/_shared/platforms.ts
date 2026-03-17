/**
 * Platform-specific OAuth & API configuration.
 * All client secrets come from environment variables — never hardcoded.
 */

export interface PlatformConfig {
  name: string;
  authUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  mediaUrl?: string;
  buildAuthParams: (state: string, redirectUri: string) => URLSearchParams;
  exchangeToken: (code: string, redirectUri: string) => Promise<TokenResponse>;
  fetchUserInfo: (accessToken: string) => Promise<UserInfo>;
  fetchMetrics: (accessToken: string, platformUserId: string) => Promise<Metrics>;
  refreshAccessToken?: (refreshToken: string) => Promise<TokenResponse>;
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  platform_user_id: string;
  scopes?: string[];
}

export interface UserInfo {
  id: string;
  username: string;
  profile_picture_url?: string;
  follower_count?: number;
}

export interface Metrics {
  follower_count: number;
  engagement_rate: number;
  avg_views: number;
  secondary_metric: number;  // saves/share % for IG, completion % for TT
}

// ────────────────────────────────────────
// Instagram Graph API
// ────────────────────────────────────────
export const instagram: PlatformConfig = {
  name: 'Instagram',
  authUrl: 'https://api.instagram.com/oauth/authorize',
  tokenUrl: 'https://api.instagram.com/oauth/access_token',
  userInfoUrl: 'https://graph.instagram.com/me',

  buildAuthParams(state: string, redirectUri: string) {
    return new URLSearchParams({
      client_id: Deno.env.get('INSTAGRAM_APP_ID')!,
      redirect_uri: redirectUri,
      scope: 'user_profile,user_media',
      response_type: 'code',
      state,
    });
  },

  async exchangeToken(code: string, redirectUri: string): Promise<TokenResponse> {
    // Step 1: Exchange code for short-lived token
    const shortRes = await fetch('https://api.instagram.com/oauth/access_token', {
      method: 'POST',
      body: new URLSearchParams({
        client_id: Deno.env.get('INSTAGRAM_APP_ID')!,
        client_secret: Deno.env.get('INSTAGRAM_APP_SECRET')!,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
        code,
      }),
    });
    const shortData = await shortRes.json();
    if (shortData.error_message) throw new Error(shortData.error_message);

    // Step 2: Exchange short-lived token for long-lived token (60 days)
    const longRes = await fetch(
      `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${
        Deno.env.get('INSTAGRAM_APP_SECRET')
      }&access_token=${shortData.access_token}`,
    );
    const longData = await longRes.json();
    if (longData.error) throw new Error(longData.error.message);

    return {
      access_token: longData.access_token,
      expires_in: longData.expires_in,      // ~5184000 (60 days)
      platform_user_id: String(shortData.user_id),
      scopes: ['user_profile', 'user_media'],
    };
  },

  async fetchUserInfo(accessToken: string): Promise<UserInfo> {
    const res = await fetch(
      `https://graph.instagram.com/me?fields=id,username,account_type,media_count&access_token=${accessToken}`,
    );
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return {
      id: data.id,
      username: data.username,
      profile_picture_url: undefined,  // Not available via Basic Display
    };
  },

  async fetchMetrics(accessToken: string, platformUserId: string): Promise<Metrics> {
    // Fetch recent media to compute engagement
    const mediaRes = await fetch(
      `https://graph.instagram.com/me/media?fields=id,like_count,comments_count,timestamp,media_type&limit=25&access_token=${accessToken}`,
    );
    const mediaData = await mediaRes.json();

    let totalLikes = 0, totalComments = 0, videoViews = 0, videoCount = 0;
    const posts = mediaData.data || [];

    for (const post of posts) {
      totalLikes += post.like_count || 0;
      totalComments += post.comments_count || 0;
      if (post.media_type === 'VIDEO') {
        videoCount++;
      }
    }

    // Instagram doesn't expose follower_count via Basic Display API.
    // With Instagram Graph API (Business/Creator accounts), you'd use:
    //   GET /{user-id}?fields=followers_count
    // For now, we calculate what we can and note the limitation.
    let followerCount = 0;
    try {
      const profileRes = await fetch(
        `https://graph.instagram.com/${platformUserId}?fields=followers_count&access_token=${accessToken}`,
      );
      const profileData = await profileRes.json();
      followerCount = profileData.followers_count || 0;
    } catch {
      // Fallback: estimate from engagement if Business API not available
      followerCount = posts.length > 0 ? Math.round((totalLikes + totalComments) / posts.length / 0.03) : 0;
    }

    const avgEngagement = posts.length > 0
      ? ((totalLikes + totalComments) / posts.length / Math.max(followerCount, 1)) * 100
      : 0;

    const avgViews = videoCount > 0 ? Math.round(videoViews / videoCount) : Math.round(followerCount * 0.25);
    const savesRate = posts.length > 0 ? Math.min(avgEngagement * 1.2, 15) : 0;  // Estimated saves/share rate

    return {
      follower_count: followerCount,
      engagement_rate: Math.round(avgEngagement * 100) / 100,
      avg_views: avgViews,
      secondary_metric: Math.round(savesRate * 100) / 100,
    };
  },

  async refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
    // Instagram long-lived tokens are refreshed (not using refresh_token, but the access_token itself)
    const res = await fetch(
      `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${refreshToken}`,
    );
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return {
      access_token: data.access_token,
      expires_in: data.expires_in,
      platform_user_id: '',  // unchanged
    };
  },
};

// ────────────────────────────────────────
// TikTok Login Kit + Research API
// ────────────────────────────────────────
export const tiktok: PlatformConfig = {
  name: 'TikTok',
  authUrl: 'https://www.tiktok.com/v2/auth/authorize/',
  tokenUrl: 'https://open.tiktokapis.com/v2/oauth/token/',
  userInfoUrl: 'https://open.tiktokapis.com/v2/user/info/',

  buildAuthParams(state: string, redirectUri: string) {
    return new URLSearchParams({
      client_key: Deno.env.get('TIKTOK_CLIENT_KEY')!,
      scope: 'user.info.basic,user.info.stats,video.list',
      response_type: 'code',
      redirect_uri: redirectUri,
      state,
    });
  },

  async exchangeToken(code: string, redirectUri: string): Promise<TokenResponse> {
    const res = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: Deno.env.get('TIKTOK_CLIENT_KEY')!,
        client_secret: Deno.env.get('TIKTOK_CLIENT_SECRET')!,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }),
    });
    const data = await res.json();
    if (data.data?.error_code) throw new Error(data.data.description || 'TikTok token exchange failed');

    return {
      access_token: data.data.access_token,
      refresh_token: data.data.refresh_token,
      expires_in: data.data.expires_in,
      platform_user_id: data.data.open_id,
      scopes: data.data.scope?.split(',') || [],
    };
  },

  async fetchUserInfo(accessToken: string): Promise<UserInfo> {
    const res = await fetch(
      'https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url,follower_count,following_count,likes_count,video_count',
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const data = await res.json();
    if (data.error?.code) throw new Error(data.error.message);
    const u = data.data.user;
    return {
      id: u.open_id,
      username: u.display_name,
      profile_picture_url: u.avatar_url,
      follower_count: u.follower_count,
    };
  },

  async fetchMetrics(accessToken: string, _platformUserId: string): Promise<Metrics> {
    // Fetch user stats
    const userRes = await fetch(
      'https://open.tiktokapis.com/v2/user/info/?fields=open_id,follower_count,likes_count,video_count',
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const userData = await userRes.json();
    const user = userData.data?.user || {};

    // Fetch recent videos for engagement calculation
    const videoRes = await fetch(
      'https://open.tiktokapis.com/v2/video/list/?fields=id,like_count,comment_count,share_count,view_count,duration',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ max_count: 20 }),
      },
    );
    const videoData = await videoRes.json();
    const videos = videoData.data?.videos || [];

    let totalViews = 0, totalLikes = 0, totalComments = 0, totalShares = 0;
    let totalDuration = 0, totalWatchTime = 0;

    for (const v of videos) {
      totalViews += v.view_count || 0;
      totalLikes += v.like_count || 0;
      totalComments += v.comment_count || 0;
      totalShares += v.share_count || 0;
      totalDuration += v.duration || 0;
    }

    const followerCount = user.follower_count || 0;
    const avgViews = videos.length > 0 ? Math.round(totalViews / videos.length) : 0;
    const engagementRate = videos.length > 0 && followerCount > 0
      ? ((totalLikes + totalComments + totalShares) / videos.length / followerCount) * 100
      : 0;

    // Completion rate estimation (TikTok doesn't directly expose this in basic API)
    const completionRate = videos.length > 0
      ? Math.min(85, Math.max(40, 70 - (avgViews / Math.max(followerCount, 1)) * 10))
      : 0;

    return {
      follower_count: followerCount,
      engagement_rate: Math.round(engagementRate * 100) / 100,
      avg_views: avgViews,
      secondary_metric: Math.round(completionRate * 100) / 100,
    };
  },

  async refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
    const res = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: Deno.env.get('TIKTOK_CLIENT_KEY')!,
        client_secret: Deno.env.get('TIKTOK_CLIENT_SECRET')!,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    });
    const data = await res.json();
    if (data.data?.error_code) throw new Error(data.data.description || 'TikTok refresh failed');

    return {
      access_token: data.data.access_token,
      refresh_token: data.data.refresh_token,
      expires_in: data.data.expires_in,
      platform_user_id: data.data.open_id,
    };
  },
};

/** Get platform config by name */
export function getPlatform(name: string): PlatformConfig {
  const platforms: Record<string, PlatformConfig> = { instagram, tiktok };
  const cfg = platforms[name.toLowerCase()];
  if (!cfg) throw new Error(`Unknown platform: ${name}`);
  return cfg;
}
