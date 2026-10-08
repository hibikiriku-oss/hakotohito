"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import liff from "@line/liff";

type Match = {
  id: string;
  request_id: string;
  performer_id: string;
  matched_at: string;
  status: string;
  performance_requests:
    | {
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
        facility_id: string;
      }
    | Array<{
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
        facility_id: string;
      }>;
  performers:
    | {
        id: string;
        name: string | null;
        instruments: string[];
        genres: string[];
        area: string | null;
        bio: string | null;
        users:
          | {
              id: string;
              display_name: string | null;
              picture_url: string | null;
            }
          | Array<{
              id: string;
              display_name: string | null;
              picture_url: string | null;
            }>;
      }
    | Array<{
        id: string;
        name: string | null;
        instruments: string[];
        genres: string[];
        area: string | null;
        bio: string | null;
        users:
          | {
              id: string;
              display_name: string | null;
              picture_url: string | null;
            }
          | Array<{
              id: string;
              display_name: string | null;
              picture_url: string | null;
            }>;
      }>;
};

type Application = {
  id: string;
  message: string | null;
  status: string;
  created_at: string;
};

function getRequest(
  request: Match["performance_requests"] | undefined
) {
  if (Array.isArray(request)) {
    return request[0];
  }

  return request;
}

function getPerformer(
  performer: Match["performers"] | undefined
) {
  if (Array.isArray(performer)) {
    return performer[0];
  }

  return performer;
}

function getUser(
  users:
    | {
        id: string;
        display_name: string | null;
        picture_url: string | null;
      }
    | Array<{
        id: string;
        display_name: string | null;
        picture_url: string | null;
      }>
    | undefined
) {
  if (Array.isArray(users)) {
    return users[0];
  }

  return users;
}

function formatDate(date: string) {
  const value = new Date(date);

  return (
    value.getFullYear() +
    "年" +
    (value.getMonth() + 1) +
    "月" +
    value.getDate() +
    "日"
  );
}

export default function FacilityMatchDetailPage() {
  const router = useRouter();
  const params = useParams();

  const matchId = params.id as string;

  const [match, setMatch] = useState<Match | null>(null);
  const [application, setApplication] =
    useState<Application | null>(null);

  const [reviewed, setReviewed] = useState(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadMatch() {
      try {
        await liff.init({
          liffId: process.env.NEXT_PUBLIC_LIFF_ID!,
        });

        if (!liff.isLoggedIn()) {
          liff.login();
          return;
        }

        const profile = await liff.getProfile();

        const response = await fetch(
          "/api/facility/matches/" + matchId,
          {
            headers: {
              "x-line-user-id": profile.userId,
            },
          }
        );

        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            data.error ||
              "マッチング情報の取得に失敗しました"
          );
        }

        setMatch(data.match);
        setApplication(data.application || null);

        const reviewResponse = await fetch(
          "/api/reviews?match_id=" + matchId,
          {
            headers: {
              "x-line-user-id": profile.userId,
            },
          }
        );

        if (reviewResponse.ok) {
          const reviewData = await reviewResponse.json();
          setReviewed(reviewData.reviewed);
        }
      } catch (err) {
        console.error(err);

        setError(
          err instanceof Error
            ? err.message
            : "エラーが発生しました"
        );
      } finally {
        setLoading(false);
      }
    }

    loadMatch();
  }, [matchId]);

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-md mx-auto">
          <p className="text-gray-600">
            読み込み中...
          </p>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-md mx-auto">
          <h1 className="text-xl font-bold">
            エラー
          </h1>

          <p className="mt-4 text-red-600">
            {error}
          </p>

          <button
            onClick={() =>
              router.push("/facility/matches")
            }
            className="mt-6 w-full bg-black text-white rounded-xl p-4"
          >
            マッチング一覧に戻る
          </button>
        </div>
      </main>
    );
  }

  if (!match) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-md mx-auto">
          <p>
            マッチング情報が見つかりません。
          </p>
        </div>
      </main>
    );
  }

  const performanceRequest =
    getRequest(match.performance_requests);

  const performer =
    getPerformer(match.performers);

  const lineUser =
    getUser(performer?.users);

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-md mx-auto">

        <button
          onClick={() =>
            router.push("/facility/matches")
          }
          className="text-gray-600 mb-4"
        >
          ← マッチング一覧に戻る
        </button>

        <div className="bg-white rounded-2xl p-6 shadow-sm">

          <div className="text-center">
            <div className="text-4xl">
              🎉
            </div>

            <h1 className="text-2xl font-bold mt-2">
              マッチング成立
            </h1>

            <p className="mt-2 text-green-600 font-medium">
              演奏者とのマッチングが成立しています
            </p>
          </div>

          {performanceRequest && (
            <section className="mt-8">
              <h2 className="text-lg font-bold border-b pb-2">
                🎵 演奏案件
              </h2>

              <div className="mt-4 space-y-3">

                <div>
                  <p className="text-sm text-gray-500">
                    案件タイトル
                  </p>

                  <p className="font-medium">
                    {performanceRequest.title}
                  </p>
                </div>

                {performanceRequest.description && (
                  <div>
                    <p className="text-sm text-gray-500">
                      案件内容
                    </p>

                    <p>
                      {performanceRequest.description}
                    </p>
                  </div>
                )}

                <div>
                  <p className="text-sm text-gray-500">
                    演奏日時
                  </p>

                  <p>
                    {formatDate(
                      performanceRequest.performance_date
                    )}
                    <br />
                    {performanceRequest.start_time}
                    {" ～ "}
                    {performanceRequest.end_time}
                  </p>
                </div>

                <div>
                  <p className="text-sm text-gray-500">
                    場所
                  </p>

                  <p>
                    {performanceRequest.area ||
                      "未設定"}
                  </p>
                </div>

                <div>
                  <p className="text-sm text-gray-500">
                    報酬
                  </p>

                  <p>
                    {performanceRequest.reward !==
                    null
                      ? performanceRequest.reward +
                        "円"
                      : "未設定"}
                  </p>
                </div>

              </div>
            </section>
          )}

          {performer && (
            <section className="mt-8">
              <h2 className="text-lg font-bold border-b pb-2">
                🎸 演奏者
              </h2>

              <div className="mt-4">

                <div className="flex items-center gap-4">

                  {lineUser?.picture_url ? (
                    <img
                      src={lineUser.picture_url}
                      alt="プロフィール画像"
                      className="w-16 h-16 rounded-full object-cover"
                    />
                  ) : (
                    <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center text-2xl">
                      🎸
                    </div>
                  )}

                  <div>
                    <p className="text-lg font-bold">
                      {performer.name ||
                        "名前未設定"}
                    </p>

                    {lineUser?.display_name && (
                      <p className="text-sm text-gray-500">
                        LINE表示名：
                        {lineUser.display_name}
                      </p>
                    )}
                  </div>

                </div>

                <div className="mt-5 space-y-3">

                  <div>
                    <p className="text-sm text-gray-500">
                      活動エリア
                    </p>

                    <p>
                      {performer.area ||
                        "未設定"}
                    </p>
                  </div>

                  <div>
                    <p className="text-sm text-gray-500">
                      楽器
                    </p>

                    <p>
                      {performer.instruments?.length
                        ? performer.instruments.join(
                            "、"
                          )
                        : "未設定"}
                    </p>
                  </div>

                  <div>
                    <p className="text-sm text-gray-500">
                      ジャンル
                    </p>

                    <p>
                      {performer.genres?.length
                        ? performer.genres.join(
                            "、"
                          )
                        : "未設定"}
                    </p>
                  </div>

                  <div>
                    <p className="text-sm text-gray-500">
                      自己紹介
                    </p>

                    <p className="whitespace-pre-wrap">
                      {performer.bio ||
                        "自己紹介はありません"}
                    </p>
                  </div>

                </div>
              </div>
            </section>
          )}

          <section className="mt-8">
            <h2 className="text-lg font-bold border-b pb-2">
              💬 応募時のメッセージ
            </h2>

            <div className="mt-4 bg-gray-50 rounded-xl p-4">

              {application?.message ? (
                <p className="whitespace-pre-wrap">
                  {application.message}
                </p>
              ) : (
                <p className="text-gray-500">
                  応募メッセージはありません。
                </p>
              )}

            </div>
          </section>

          <section className="mt-8 bg-gray-50 rounded-2xl p-5 border">
            <h2 className="text-lg font-bold">
              ⭐ 演奏者を評価
            </h2>

            {reviewed ? (
              <div className="mt-4 bg-white rounded-xl p-4">
                <p className="text-gray-700 font-bold">
                  評価済みです
                </p>

                <p className="mt-1 text-sm text-gray-500">
                  このマッチングはすでに評価しています。
                </p>
              </div>
            ) : (
              <button
                onClick={() =>
                  router.push(
                    `/facility/matches/${matchId}/review`
                  )
                }
                className="w-full mt-4 bg-yellow-500 text-white rounded-xl p-4 font-bold"
              >
                ⭐ この演奏者を評価する
              </button>
            )}
          </section>

        </div>
      </div>
    </main>
  );
}