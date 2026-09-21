import { BadRequestException } from "@nestjs/common";
import { getEnv } from "../config/env";
import type { OAuthProfile } from "./auth.service";

export type OAuthProviderName = "github" | "google";

const STATE_COOKIE = "cc_oauth_state";
const STATE_TTL_MS = 10 * 60 * 1000;

export const oauthStateCookie = { name: STATE_COOKIE, maxAge: STATE_TTL_MS };

function requireCredentials(provider: OAuthProviderName): {
  clientId: string;
  clientSecret: string;
} {
  const env = getEnv();
  const clientId =
    provider === "github" ? env.GITHUB_CLIENT_ID : env.GOOGLE_CLIENT_ID;
  const clientSecret =
    provider === "github" ? env.GITHUB_CLIENT_SECRET : env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new BadRequestException({ error: "oauth_not_configured", provider });
  }
  return { clientId, clientSecret };
}

export function buildAuthorizeUrl(
  provider: OAuthProviderName,
  state: string,
): string {
  const { clientId } = requireCredentials(provider);
  const redirectUri = `${getEnv().API_PUBLIC_URL}/api/auth/oauth/${provider}/callback`;
  if (provider === "github") {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: "read:user user:email",
      state,
      allow_signup: "true",
    });
    return `https://github.com/login/oauth/authorize?${params}`;
  }
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

/** Exchange the authorization code for an access token. */
async function exchangeCode(
  provider: OAuthProviderName,
  code: string,
): Promise<{ access_token: string; id_token?: string }> {
  const { clientId, clientSecret } = requireCredentials(provider);
  const redirectUri = `${getEnv().API_PUBLIC_URL}/api/auth/oauth/${provider}/callback`;

  const body =
    provider === "github"
      ? {
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: redirectUri,
        }
      : {
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        };

  const url =
    provider === "github"
      ? "https://github.com/login/oauth/access_token"
      : "https://oauth2.googleapis.com/token";
  const response = await fetch(url, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok)
    throw new BadRequestException({ error: "oauth_exchange_failed" });
  const json = (await response.json()) as {
    access_token?: string;
    id_token?: string;
  };
  if (!json.access_token)
    throw new BadRequestException({ error: "oauth_exchange_failed" });
  return { access_token: json.access_token, id_token: json.id_token };
}

function decodeIdToken(idToken: string): {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
  aud?: string;
} {
  const payloadPart = idToken.split(".")[1];
  if (!payloadPart)
    throw new BadRequestException({ error: "oauth_invalid_id_token" });
  return JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")) as {
    sub: string;
    email?: string;
    name?: string;
    picture?: string;
    aud?: string;
  };
}

/** Fetch the user profile from the provider after code exchange. */
export async function fetchOAuthProfile(
  provider: OAuthProviderName,
  code: string,
): Promise<OAuthProfile> {
  const tokens = await exchangeCode(provider, code);
  const accessToken = tokens.access_token;

  if (provider === "github") {
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": "collabcanvas",
      Accept: "application/vnd.github+json",
    };
    const userResponse = await fetch("https://api.github.com/user", {
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    if (!userResponse.ok)
      throw new BadRequestException({ error: "oauth_profile_failed" });
    const user = (await userResponse.json()) as {
      id: number;
      login: string;
      name: string | null;
      avatar_url: string;
      email: string | null;
    };

    let email = user.email;
    if (!email) {
      const emailsResponse = await fetch("https://api.github.com/user/emails", {
        headers,
        signal: AbortSignal.timeout(10_000),
      });
      if (emailsResponse.ok) {
        const emails = (await emailsResponse.json()) as {
          email: string;
          primary: boolean;
          verified: boolean;
        }[];
        email =
          emails.find((e) => e.primary && e.verified)?.email ??
          emails[0]?.email ??
          null;
      }
    }
    if (!email) throw new BadRequestException({ error: "oauth_email_missing" });

    return {
      provider,
      providerAccountId: String(user.id),
      email,
      name: user.name ?? user.login,
      image: user.avatar_url,
    };
  }

  // Google: the id_token comes straight from the token endpoint over TLS;
  // verify the audience matches our client id before trusting the claims.
  if (!tokens.id_token)
    throw new BadRequestException({ error: "oauth_exchange_failed" });

  const claims = decodeIdToken(tokens.id_token);
  const { clientId } = requireCredentials("google");
  if (claims.aud !== clientId)
    throw new BadRequestException({ error: "oauth_aud_mismatch" });
  if (!claims.sub)
    throw new BadRequestException({ error: "oauth_subject_missing" });
  if (!claims.email)
    throw new BadRequestException({ error: "oauth_email_missing" });

  return {
    provider,
    providerAccountId: claims.sub,
    email: claims.email,
    name: claims.name ?? null,
    image: claims.picture ?? null,
  };
}
