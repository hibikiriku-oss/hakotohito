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
      console.log(
        "LINE通知送信成功:",
        to
      );

      return {
        success: true,
      };
    }

    const responseText =
      await response.text();

    const error =
      `LINE通知送信エラー: ${response.status} ${responseText}`;

    console.error(error);

    return {
      success: false,
      error,
    };
  } catch (error) {
    console.error(
      "LINE通知通信エラー:",
      error
    );

    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "LINE通知通信中にエラーが発生しました",
    };
  }
}