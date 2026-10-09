"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import liff from "@line/liff";

type User = {
  id: string;
  display_name: string | null;
  picture_url: string | null;
};

type Performer = {
  id: string;
  user_id: string;
  name: string;
  instruments: string[];
  genres: string[];
  area: string;
  bio: string | null;
  users: User | User[] | null;
};

type PerformanceRequest = {
  id: string;
  title: string;
  description: string | null;
  performance_date: string;
  start_time: string;
  end_time: string;
  area: string | null;
  instruments: string[];
  genres: string[];
  reward: number | null;
  status: string;
};

export default function FacilityPerformerInvitePage() {
  const router = useRouter();
  const params = useParams();

  const performerId = params.id as string;

  const [lineUserId, setLineUserId] = useState("");

  const [performer, setPerformer] =
    useState<Performer | null>(null);

  const [rating, setRating] =
    useState<number | null>(null);

  const [reviewCount, setReviewCount] =
    useState(0);

  const [requests, setRequests] =
    useState<PerformanceRequest[]>([]);

  const [selectedRequestId, setSelectedRequestId] =
    useState("");

  const [message, setMessage] =
    useState("");

  const [loading, setLoading] =
    useState(true);

  const [sending, setSending] =
    useState(false);

  const [error, setError] =
    useState("");

  const [success, setSuccess] =
    useState("");

  useEffect(() => {
    async function initialize() {
      try {
        await liff.init({
          liffId:
            process.env.NEXT_PUBLIC_LIFF_ID || "",
        });

        if (!liff.isLoggedIn()) {
          liff.login();
          return;
        }

        const profile =
          await liff.getProfile();

        setLineUserId(profile.userId);

        const [
          performerResponse,
          requestsResponse,
        ] = await Promise.all([
          fetch(
            `/api/performers/${performerId}`
          ),
          fetch(
            "/api/facility/requests",
            {
              headers: {
                "x-line-user-id":
                  profile.userId,
              },
            }
          ),
        ]);

        const performerData =
          await performerResponse.json();

        const requestsData =
          await requestsResponse.json();

        if (!performerResponse.ok) {
          throw new Error(
            performerData.error ||
              "演奏者の情報を取得できませんでした"
          );
        }

        if (!requestsResponse.ok) {
          throw new Error(
            requestsData.error ||
              "案件情報を取得できませんでした"
          );
        }

        setPerformer(
          performerData.performer || null
        );

        setRating(
          performerData.rating ?? null
        );

        setReviewCount(
          performerData.review_count ?? 0
        );

        const openRequests =
          (requestsData.requests || []).filter(
            (request: PerformanceRequest) =>
              request.status === "open"
          );

        setRequests(openRequests);
      } catch (error) {
        console.error(
          "依頼画面初期化エラー:",
          error
        );

        setError(
          error instanceof Error
            ? error.message
            : "情報の取得に失敗しました"
        );
      } finally {
        setLoading(false);
      }
    }

    initialize();
  }, [performerId]);

  const handleSubmit = async () => {
    if (!lineUserId) {
      setError(
        "LINEユーザー情報を取得できませんでした"
      );
      return;
    }

    if (!selectedRequestId) {
      setError(
        "依頼する案件を選択してください"
      );
      return;
    }

    setError("");
    setSuccess("");
    setSending(true);

    try {
      const response = await fetch(
        "/api/facility/invitations",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
            "x-line-user-id":
              lineUserId,
          },
          body: JSON.stringify({
            request_id:
              selectedRequestId,
            performer_id:
              performerId,
            message:
              message.trim() || null,
          }),
        }
      );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
            "依頼の送信に失敗しました"
        );
      }

      setSuccess(
        "演奏依頼を送信しました"
      );

      setTimeout(() => {
        router.push(
          "/facility/performers"
        );
      }, 1200);
    } catch (error) {
      console.error(
        "演奏依頼送信エラー:",
        error
      );

      setError(
        error instanceof Error
          ? error.message
          : "依頼の送信に失敗しました"
      );
    } finally {
      setSending(false);
    }
  };

  const formatDate = (
    date: string
  ) => {
    const parsedDate =
      new Date(`${date}T00:00:00`);

    return parsedDate.toLocaleDateString(
      "ja-JP",
      {
        year: "numeric",
        month: "long",
        day: "numeric",
        weekday: "short",
      }
    );
  };

  const formatTime = (
    time: string
  ) => {
    return time.slice(0, 5);
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-md mx-auto">
          <h1 className="text-2xl font-bold">
            🎹 演奏者に依頼する
          </h1>

          <p className="mt-8 text-center text-gray-500">
            情報を読み込んでいます…
          </p>
        </div>
      </main>
    );
  }

  if (error && !performer) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-md mx-auto">
          <h1 className="text-2xl font-bold">
            🎹 演奏者に依頼する
          </h1>

          <div className="mt-6 p-4 bg-red-50 rounded-xl">
            <p className="text-red-600">
              {error}
            </p>
          </div>

          <button
            type="button"
            onClick={() =>
              router.push(
                "/facility/performers"
              )
            }
            className="w-full mt-6 bg-white border rounded-xl p-4"
          >
            ← 演奏者を探すへ戻る
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-md mx-auto">

        <div className="mb-6">
          <button
            type="button"
            onClick={() =>
              router.push(
                "/facility/performers"
              )
            }
            className="text-sm text-gray-500 mb-4"
          >
            ← 演奏者一覧へ戻る
          </button>

          <h1 className="text-2xl font-bold">
            🎹 演奏者に依頼する
          </h1>

          <p className="text-sm text-gray-500 mt-1">
            募集中の案件を選択して依頼できます
          </p>
        </div>

        {performer && (
          <div className="bg-white rounded-2xl p-5 shadow-sm border mb-6">
            <p className="text-sm text-gray-500">
              依頼する演奏者
            </p>

            <h2 className="text-xl font-bold mt-1">
              🎹 {performer.name}
            </h2>

            <p className="text-sm text-gray-500 mt-1">
              📍 {performer.area}
            </p>

            <div className="mt-3 flex items-center gap-3">
              <div className="flex items-center gap-1">
                <span className="text-yellow-500">
                  ⭐
                </span>

                <span className="font-bold">
                  {rating !== null
                    ? rating.toFixed(1)
                    : "評価なし"}
                </span>
              </div>

              <span className="text-sm text-gray-500">
                📝 {reviewCount}件のレビュー
              </span>
            </div>

            {performer.instruments?.length >
              0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {performer.instruments.map(
                  (instrument) => (
                    <span
                      key={instrument}
                      className="text-xs bg-gray-100 rounded-full px-3 py-1"
                    >
                      {instrument}
                    </span>
                  )
                )}
              </div>
            )}
          </div>
        )}

        <div className="bg-white rounded-2xl p-5 shadow-sm border">
          <h2 className="text-lg font-bold">
            📋 依頼する案件を選択
          </h2>

          <p className="text-sm text-gray-500 mt-1">
            現在募集中の案件から選択してください
          </p>

          {requests.length === 0 ? (
            <div className="mt-5 p-5 bg-gray-50 rounded-xl text-center">
              <p className="text-gray-500">
                現在、募集中の案件がありません。
              </p>

              <button
                type="button"
                onClick={() =>
                  router.push(
                    "/facility/request"
                  )
                }
                className="mt-4 text-blue-600 text-sm font-medium"
              >
                ＋ 新しい案件を登録する
              </button>
            </div>
          ) : (
            <div className="mt-5 space-y-3">
              {requests.map(
                (request) => {
                  const selected =
                    selectedRequestId ===
                    request.id;

                  return (
                    <button
                      key={request.id}
                      type="button"
                      onClick={() =>
                        setSelectedRequestId(
                          request.id
                        )
                      }
                      className={`w-full text-left rounded-xl border p-4 ${
                        selected
                          ? "border-blue-500 bg-blue-50"
                          : "border-gray-200 bg-white"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className={`mt-1 w-5 h-5 rounded-full border flex items-center justify-center ${
                            selected
                              ? "border-blue-500"
                              : "border-gray-300"
                          }`}
                        >
                          {selected && (
                            <div className="w-3 h-3 rounded-full bg-blue-500" />
                          )}
                        </div>

                        <div className="flex-1 min-w-0">
                          <h3 className="font-bold">
                            {request.title}
                          </h3>

                          <p className="mt-2 text-sm text-gray-600">
                            📅{" "}
                            {formatDate(
                              request.performance_date
                            )}
                          </p>

                          <p className="mt-1 text-sm text-gray-600">
                            🕐{" "}
                            {formatTime(
                              request.start_time
                            )}
                            {" ～ "}
                            {formatTime(
                              request.end_time
                            )}
                          </p>

                          {request.area && (
                            <p className="mt-1 text-sm text-gray-600">
                              📍 {request.area}
                            </p>
                          )}

                          {request.reward !==
                            null && (
                            <p className="mt-1 text-sm font-medium text-gray-700">
                              💰 報酬{" "}
                              {request.reward.toLocaleString()}
                              円
                            </p>
                          )}

                          {request.description && (
                            <p className="mt-3 text-sm text-gray-500 line-clamp-3">
                              {
                                request.description
                              }
                            </p>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                }
              )}
            </div>
          )}

          {requests.length > 0 && (
            <>
              <div className="mt-6">
                <label className="block text-sm font-medium mb-2">
                  💬 依頼メッセージ
                </label>

                <textarea
                  value={message}
                  onChange={(event) =>
                    setMessage(
                      event.target.value
                    )
                  }
                  rows={5}
                  placeholder="演奏者へのメッセージを入力してください"
                  className="w-full border rounded-xl p-3 resize-none"
                />

                <p className="mt-2 text-xs text-gray-400">
                  例：ぜひこちらのイベントで演奏をお願いしたいです。ご検討よろしくお願いします。
                </p>
              </div>

              {error && (
                <div className="mt-4 p-4 bg-red-50 rounded-xl">
                  <p className="text-sm text-red-600">
                    {error}
                  </p>
                </div>
              )}

              {success && (
                <div className="mt-4 p-4 bg-green-50 rounded-xl">
                  <p className="text-sm text-green-600">
                    {success}
                  </p>
                </div>
              )}

              <button
                type="button"
                onClick={handleSubmit}
                disabled={
                  sending ||
                  !selectedRequestId
                }
                className={`w-full mt-5 rounded-xl p-4 font-bold ${
                  sending ||
                  !selectedRequestId
                    ? "bg-gray-300 text-gray-500"
                    : "bg-blue-600 text-white"
                }`}
              >
                {sending
                  ? "送信中..."
                  : "この案件で依頼を送信"}
              </button>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={() =>
            router.push(
              "/facility/home"
            )
          }
          className="w-full mt-6 bg-white border rounded-xl p-4"
        >
          ← 施設ホームへ戻る
        </button>

      </div>
    </main>
  );
}