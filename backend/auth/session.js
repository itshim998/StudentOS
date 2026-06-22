function extractBearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization || "";
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

export async function getRequestSession(req, { config, authClient }) {
  const accessToken = extractBearerToken(req);
  const authAvailable = config.authConfigured && authClient?.isConfigured?.();

  if (!accessToken) {
    return {
      mode: "local_demo",
      authenticated: false,
      tokenPresent: false,
      user: {
        id: "student_demo_001",
        email: "demo@studentos.local",
      },
    };
  }

  if (!authAvailable) {
    const error = new Error("StudentOS sign-in is not configured for token verification");
    error.status = 503;
    throw error;
  }

  try {
    const user = await authClient.getUser(accessToken);
    if (!user?.id) {
      const error = new Error("Invalid StudentOS access token");
      error.status = 401;
      throw error;
    }
    return {
      mode: "supabase_auth",
      authenticated: true,
      tokenPresent: true,
      user,
    };
  } catch (error) {
    error.status = error.status === 503 ? 503 : 401;
    error.message = "Invalid or expired StudentOS session";
    throw error;
  }
}
