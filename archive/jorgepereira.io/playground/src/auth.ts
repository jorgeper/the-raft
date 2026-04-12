import { Google, generateState, generateCodeVerifier } from "arctic";
import { Router, type Request, type Response } from "express";
import fs from "fs";

const COOKIE_NAME = "playground_session";
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function isSecure(): boolean {
  return process.env.NODE_ENV === "production";
}

/** Decode the payload of a JWT without verifying the signature.
 *  Safe here because the token comes directly from Google's token endpoint
 *  (validated via the authorization code exchange). */
function decodeJwtPayload(token: string): Record<string, unknown> {
  const payload = token.split(".")[1];
  return JSON.parse(Buffer.from(payload, "base64url").toString());
}

interface Identity {
  id: string;
  name: string;
  emails: string[];
}

function loadIdentities(): Map<string, Identity> {
  const filePath = process.env.IDENTITIES_FILE || "data/identities.json";
  try {
    const entries: Identity[] = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    const lookup = new Map<string, Identity>();
    for (const entry of entries) {
      for (const email of entry.emails) {
        lookup.set(email.toLowerCase(), entry);
      }
    }
    return lookup;
  } catch (e) {
    console.warn("Failed to load identities:", e);
    return new Map();
  }
}

export function getSession(
  req: Request
): { id: string; email: string } | null {
  const cookie = req.signedCookies?.[COOKIE_NAME];
  if (!cookie) return null;
  try {
    return JSON.parse(cookie);
  } catch {
    return null;
  }
}

export function createAuthRouter(): Router {
  const router = Router();
  const clientId = process.env.GOOGLE_CLIENT_ID || "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || "";

  router.get("/login", (req: Request, res: Response) => {
    const redirectUri = `${req.protocol}://${req.get("host")}/auth/callback`;
    const google = new Google(clientId, clientSecret, redirectUri);

    const state = generateState();
    const codeVerifier = generateCodeVerifier();
    const scopes = ["openid", "email", "profile"];
    const url = google.createAuthorizationURL(state, codeVerifier, scopes);

    const cookieOpts = {
      signed: true,
      httpOnly: true,
      maxAge: 5 * 60 * 1000,
      secure: isSecure(),
      sameSite: "lax" as const,
    };
    res.cookie("oauth_state", state, cookieOpts);
    res.cookie("oauth_verifier", codeVerifier, cookieOpts);

    res.redirect(url.toString());
  });

  router.get(
    "/auth/callback",
    async (req: Request, res: Response): Promise<void> => {
      try {
        const code = req.query.code as string;
        const state = req.query.state as string;
        const storedState = req.signedCookies?.oauth_state;
        const codeVerifier = req.signedCookies?.oauth_verifier;

        if (!code || !state || state !== storedState || !codeVerifier) {
          res.status(403).send("Invalid OAuth state");
          return;
        }

        const redirectUri = `${req.protocol}://${req.get("host")}/auth/callback`;
        const google = new Google(clientId, clientSecret, redirectUri);

        const tokens = await google.validateAuthorizationCode(
          code,
          codeVerifier
        );
        const idToken = tokens.idToken();
        const claims = decodeJwtPayload(idToken);

        const email = (claims.email as string)?.toLowerCase();
        if (!email) {
          res.status(403).send("Could not get email from Google");
          return;
        }

        const identities = loadIdentities();
        const identity = identities.get(email);
        if (!identity) {
          console.warn(`OAuth: blocked login from ${email}`);
          res.status(403).send(`Access denied for ${email}`);
          return;
        }

        console.log(`OAuth: logged in ${email} (identity=${identity.id})`);

        // Set session cookie
        res.cookie(
          COOKIE_NAME,
          JSON.stringify({ id: identity.id, email }),
          {
            signed: true,
            httpOnly: true,
            secure: isSecure(),
            sameSite: "lax",
            maxAge: SESSION_MAX_AGE_MS,
          }
        );

        // Clean up OAuth cookies
        res.clearCookie("oauth_state");
        res.clearCookie("oauth_verifier");

        // Redirect to original destination
        const returnTo = req.signedCookies?.returnTo || "/";
        res.clearCookie("returnTo");
        res.redirect(returnTo);
      } catch (e) {
        console.error("OAuth callback error:", e);
        res.status(500).send("Authentication failed");
      }
    }
  );

  router.get("/logout", (_req: Request, res: Response) => {
    res.clearCookie(COOKIE_NAME);
    res.redirect("/login");
  });

  return router;
}
