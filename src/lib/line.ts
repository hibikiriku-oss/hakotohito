export type LineMessage = {
  type: string;
  [key: string]: unknown;
};

type SendLinePushMessageResult = {
  success: boolean;
  error?: string;
};

export async function sendLinePushMessage(
  to: string,
  messages: LineMessage[]
): Promise<SendLinePushMessageResult> {
  const channelAccessToken =
    process.env.LINE_CHANNEL_ACCESS_TOKEN;

  if (!channelAccessToken) {
    const error =
      "LINE_CHANNEL_ACCESS_TOKENが設定されていません";

    console.error(error);

    return {
      success: false,
      error,
    };
  }

  if (!to) {
    const error =
      "LINE通知先のユーザーIDが指定されていません";

    console.error(error);

    return {
      success: false,
      error,
    };
  }

  if (!messages.length) {
    const error =
      "LINE通知メッセージが指定されていません";

    console.error(error);

    return {
      success: false,
      error,
    };
  }

  try {
    const response = await fetch(
      "https://api.line.me/v2/bot/message/push",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization:
            "Bearer " + channelAccessToken,
        },
        body: JSON.stringify({
          to,
          messages,
        }),
        signal: AbortSignal.timeout(10000),
      }
    );

    if (response.ok) {
      return {
        success: true,
      };
    }

    console.error("LINE通知送信失敗:", {
      status: response.status,
    });

    return {
      success: false,
      error: "LINE_PUSH_FAILED",
    };
  } catch (error) {
    console.error("LINE通知通信エラー:", {
      name: error instanceof Error ? error.name : "UnknownError",
    });

    return {
      success: false,
      error: "LINE_PUSH_NETWORK_ERROR",
    };
  }
}