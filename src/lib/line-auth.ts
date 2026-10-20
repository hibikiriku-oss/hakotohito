import "server-only";

const LINE_VERIFY_URL =
  "https://api.line.me/oauth2/v2.1/verify";

type LineVerifyResponse = {
  sub?: string;
  aud?: string;
  exp?: number;
  iss?: string;
};

export async function verifyLineIdToken(
  idToken: string
): Promise<{ userId: string } | null> {
  const channelId = process.env.LINE_LOGIN_CHANNEL_ID;

  if (!channelId || !idToken) {
    return null;
  }

  try {
    const params = new URLSearchParams({
      id_token: idToken,
      client_id: channelId,
    });

    const response = await fetch(LINE_VERIFY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
      cache: "no-store",
    });

    if (!response.ok) {
      const errorBody = await response.text();

      console.error("LINE IDトークン検証失敗", {
        status: response.status,
        body: errorBody,
      });

      return null;
    }

    const result =
      (await response.json()) as LineVerifyResponse;

    if (
      !result.sub ||
      result.aud !== channelId ||
      result.iss !== "https://access.line.me" ||
      typeof result.exp !== "number" ||
      result.exp <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }

    return { userId: result.sub };
  } catch (error) {
    console.error("LINE IDトークン検証エラー:", error);
    return null;
  }
}