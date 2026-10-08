"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import liff from "@line/liff";

type User = {
  id: string;
  display_name: string | null;
  picture_url: string | null;
};

type Facility = {
  id: string;
  name: string | null;
  address: string | null;
  description: string | null;
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

type Invitation = {
  id: string;
  request_id: string;
  performer_id: string;
  message: string | null;
  status: string;
  source: string;
  created_at: string;
  performance_request: PerformanceRequest | null;
  facility: Facility | null;
};

export default function PerformerInvitationDetailPage() {
  const router = useRouter();
  const params = useParams();

  const invitationId = params.id as string;

  const [lineUserId, setLineUserId] =
    useState("");

  const [invitation, setInvitation] =
    useState<Invitation | null>(null);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
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

        const response = await fetch(
          `/api/performer/invitations/${invitationId}`,
          {
            headers: {
              "x-line-user-id":
                profile.userId,
            },
          }
        );

        const data =
          await response.json();

        if (!response.ok) {
          throw new Error(
            data.error ||
              "演奏依頼の取得に失敗しました"
          );
        }

        setInvitation(
          data.invitation || null
        );
      } catch (error) {
        console.error(
          "演奏依頼詳細取得エラー:",
          error
        );

        setError(
          error instanceof Error
            ? error.message
            : "演奏依頼の取得に失敗しました"
        );
      } finally {
        setLoading(false);
      }
    }

    if (invitationId) {
      initialize();
    }
  }, [invitationId]);

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

  const getFacilityName = (
    facility: Facility | null
  ) => {
    if (!facility) {
      return "施設";
    }

    if (facility.name) {
      return facility.name;
    }

    if (
      Array.isArray(facility.users)
    ) {
      return (
        facility.users[0]?.display_name ||
        "施設"
      );
    }

    return (
      facility.users?.display_name ||
      "施設"
    );
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-md mx-auto">
          <p className="text-center text-gray-500 mt-10">
            演奏依頼を読み込んでいます…
          </p>
        </div>
      </main>
    );
  }

  if (error || !invitation) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-md mx-auto">
          <h1 className="text-2xl font-bold">
            🎵 演奏依頼
          </h1>

          <div className="mt-6 bg-white rounded-2xl p-5 shadow-sm border">
            <p className="text-red-600">
              {error ||
                "演奏依頼が見つかりません"}
            </p>
          </div>

          <button
            type="button"
            onClick={() =>
              router.push(
                "/performer/invitations"
              )
            }
            className="w-full mt-6 bg-white border rounded-xl p-4"
          >
            ← 演奏依頼一覧へ戻る
          </button>
        </div>
      </main>
    );
  }

  const performanceRequest =
    invitation.performance_request;

  const facilityName =
    getFacilityName(
      invitation.facility
    );

  const isPending =
    invitation.status === "pending";

  const isAccepted =
    invitation.status === "accepted";

  const isRejected =
    invitation.status === "rejected";

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-md mx-auto">

        <button
          type="button"
          onClick={() =>
            router.push(
              "/performer/invitations"
            )
          }
          className="text-sm text-gray-500 mb-4"
        >
          ← 演奏依頼一覧へ戻る
        </button>

        <h1 className="text-2xl font-bold">
          🎵 演奏依頼
        </h1>

        <p className="text-sm text-gray-500 mt-1">
          施設から届いた演奏依頼です
        </p>

        {/* ステータス */}
        <div className="mt-5">
          {isPending && (
            <span className="inline-block bg-yellow-100 text-yellow-700 text-sm font-medium px-3 py-1 rounded-full">
              ⏳ 確認待ち
            </span>
          )}

          {isAccepted && (
            <span className="inline-block bg-green-100 text-green-700 text-sm font-medium px-3 py-1 rounded-full">
              ✓ 承諾済み
            </span>
          )}

          {isRejected && (
            <span className="inline-block bg-gray-100 text-gray-600 text-sm font-medium px-3 py-1 rounded-full">
              見送り
            </span>
          )}
        </div>

        {/* 施設情報 */}
        <div className="mt-5 bg-white rounded-2xl p-5 shadow-sm border">
          <p className="text-sm text-gray-500">
            依頼元の施設
          </p>

          <h2 className="text-xl font-bold mt-1">
            🏢 {facilityName}
          </h2>

          {invitation.facility?.address && (
            <p className="text-sm text-gray-600 mt-2">
              📍 {invitation.facility.address}
            </p>
          )}

          {invitation.facility
            ?.description && (
            <p className="text-sm text-gray-600 mt-3 whitespace-pre-wrap">
              {
                invitation.facility
                  .description
              }
            </p>
          )}
        </div>

        {/* 案件情報 */}
        {performanceRequest && (
          <div className="mt-5 bg-white rounded-2xl p-5 shadow-sm border">
            <h2 className="text-lg font-bold">
              📋 案件内容
            </h2>

            <h3 className="text-xl font-bold mt-3">
              {performanceRequest.title}
            </h3>

            <div className="mt-4 space-y-2">
              <p className="text-sm text-gray-700">
                📅{" "}
                {formatDate(
                  performanceRequest.performance_date
                )}
              </p>

              <p className="text-sm text-gray-700">
                🕐{" "}
                {formatTime(
                  performanceRequest.start_time
                )}
                {" ～ "}
                {formatTime(
                  performanceRequest.end_time
                )}
              </p>

              {performanceRequest.area && (
                <p className="text-sm text-gray-700">
                  📍{" "}
                  {performanceRequest.area}
                </p>
              )}

              {performanceRequest.reward !==
                null && (
                <p className="text-sm font-medium text-gray-700">
                  💰 報酬{" "}
                  {performanceRequest.reward.toLocaleString()}
                  円
                </p>
              )}
            </div>

            {performanceRequest
              .instruments?.length > 0 && (
              <div className="mt-5">
                <p className="text-sm font-medium">
                  🎸 募集楽器
                </p>

                <div className="flex flex-wrap gap-2 mt-2">
                  {performanceRequest.instruments.map(
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
              </div>
            )}

            {performanceRequest.genres
              ?.length > 0 && (
              <div className="mt-4">
                <p className="text-sm font-medium">
                  🎵 ジャンル
                </p>

                <div className="flex flex-wrap gap-2 mt-2">
                  {performanceRequest.genres.map(
                    (genre) => (
                      <span
                        key={genre}
                        className="text-xs bg-gray-100 rounded-full px-3 py-1"
                      >
                        {genre}
                      </span>
                    )
                  )}
                </div>
              </div>
            )}

            {performanceRequest
              .description && (
              <div className="mt-5">
                <p className="text-sm font-medium">
                  📝 案件詳細
                </p>

                <p className="mt-2 text-sm text-gray-700 whitespace-pre-wrap">
                  {
                    performanceRequest.description
                  }
                </p>
              </div>
            )}
          </div>
        )}

        {/* 施設からのメッセージ */}
        {invitation.message && (
          <div className="mt-5 bg-white rounded-2xl p-5 shadow-sm border">
            <h2 className="text-lg font-bold">
              💬 施設からのメッセージ
            </h2>

            <p className="mt-3 text-sm text-gray-700 whitespace-pre-wrap">
              {invitation.message}
            </p>
          </div>
        )}

        {/* 承諾・辞退ボタン */}
        {isPending && (
          <div className="mt-6 space-y-3">
            <button
              type="button"
              onClick={() => {
                alert(
                  "承諾処理は次のステップで追加します。"
                );
              }}
              className="w-full bg-blue-600 text-white rounded-xl p-4 font-bold"
            >
              ✓ この依頼を承諾する
            </button>

            <button
              type="button"
              onClick={() => {
                alert(
                  "辞退処理は次のステップで追加します。"
                );
              }}
              className="w-full bg-white border border-gray-300 text-gray-700 rounded-xl p-4 font-bold"
            >
              今回は見送る
            </button>
          </div>
        )}

        {isAccepted && (
          <div className="mt-6 p-4 bg-green-50 rounded-xl">
            <p className="text-sm text-green-700">
              この依頼は承諾済みです。
            </p>
          </div>
        )}

        {isRejected && (
          <div className="mt-6 p-4 bg-gray-100 rounded-xl">
            <p className="text-sm text-gray-600">
              この依頼は見送り済みです。
            </p>
          </div>
        )}

        <button
          type="button"
          onClick={() =>
            router.push(
              "/performer/home"
            )
          }
          className="w-full mt-6 bg-white border rounded-xl p-4"
        >
          ← 演奏者ホームへ戻る
        </button>

      </div>
    </main>
  );
}