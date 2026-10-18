"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import liff from "@line/liff";

type Invitation = {
  id: string;
  request_id: string;
  performer_id: string;
  message: string | null;
  status: string;
  source: string;
  created_at: string;
  performance_requests: {
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
    facilities: {
      id: string;
      user_id: string;
      name: string | null;
      facility_type: string | null;
      address: string | null;
      description: string | null;
    };
  };
};

export default function PerformerInvitationDetailPage() {
  const params = useParams();
  const router = useRouter();

  const invitationId = params.id as string;

  const [invitation, setInvitation] =
    useState<Invitation | null>(null);
  const [lineUserId, setLineUserId] = useState("");
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    initialize();
  }, []);

  async function initialize() {
    try {
      setLoading(true);
      setError("");

      await liff.init({
        liffId: process.env.NEXT_PUBLIC_LIFF_ID!,
      });

      if (!liff.isLoggedIn()) {
        liff.login();
        return;
      }

      const profile = await liff.getProfile();

      setLineUserId(profile.userId);

      await fetchInvitation(profile.userId);
    } catch (error) {
      console.error("LIFF初期化エラー:", error);

      setError("LINEの初期化に失敗しました");
      setLoading(false);
    }
  }

  async function fetchInvitation(userId: string) {
    try {
      const response = await fetch(
        `/api/performer/invitations/${invitationId}`,
        {
          headers: {
            "x-line-user-id": userId,
          },
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "依頼情報の取得に失敗しました"
        );
      }

      setInvitation(data.invitation);
    } catch (error) {
      console.error("依頼取得エラー:", error);

      if (error instanceof Error) {
        setError(error.message);
      } else {
        setError("依頼情報の取得に失敗しました");
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleAccept() {
    if (!invitation || !lineUserId) {
      return;
    }

    const confirmed = window.confirm(
      "この依頼を承諾して、マッチングを成立させますか？"
    );

    if (!confirmed) {
      return;
    }

    try {
      setAccepting(true);
      setError("");
      setSuccess("");

      const response = await fetch(
        `/api/performer/invitations/${invitation.id}/accept`,
        {
          method: "POST",
          headers: {
            "x-line-user-id": lineUserId,
          },
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "依頼の承諾に失敗しました"
        );
      }

      setSuccess(
        "依頼を承諾しました。マッチングが成立しました！"
      );

      setTimeout(() => {
        router.push(`/performer/matches/${data.match.id}`);
      }, 1000);
    } catch (error) {
      console.error("依頼承諾エラー:", error);

      if (error instanceof Error) {
        setError(error.message);
      } else {
        setError("依頼の承諾に失敗しました");
      }
    } finally {
      setAccepting(false);
    }
  }

  async function handleReject() {
    if (!invitation || !lineUserId) {
      return;
    }

    const confirmed = window.confirm(
      "この依頼を辞退しますか？"
    );

    if (!confirmed) {
      return;
    }

    try {
      setRejecting(true);
      setError("");
      setSuccess("");

      const response = await fetch(
        `/api/performer/invitations/${invitation.id}/reject`,
        {
          method: "POST",
          headers: {
            "x-line-user-id": lineUserId,
          },
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "依頼の辞退に失敗しました"
        );
      }

      setSuccess("依頼を辞退しました。");

      setTimeout(() => {
        router.push("/performer/invitations");
      }, 1000);
    } catch (error) {
      console.error("依頼辞退エラー:", error);

      if (error instanceof Error) {
        setError(error.message);
      } else {
        setError("依頼の辞退に失敗しました");
      }
    } finally {
      setRejecting(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-md mx-auto">
          <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden animate-pulse">
            <div className="h-32 bg-gray-200" />

            <div className="p-5 space-y-5">
              <div className="h-5 bg-gray-200 rounded w-1/3" />
              <div className="h-20 bg-gray-100 rounded-2xl" />
              <div className="h-20 bg-gray-100 rounded-2xl" />
              <div className="h-20 bg-gray-100 rounded-2xl" />
            </div>
          </div>
        </div>
      </main>
    );
  }

  if (error && !invitation) {
    return (
      <main className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-md mx-auto pt-4">
          <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6">
            <div className="w-12 h-12 rounded-2xl bg-red-50 flex items-center justify-center text-2xl mb-4">
              ⚠️
            </div>

            <h1 className="text-xl font-bold text-gray-900 mb-3">
              オファー詳細を表示できません
            </h1>

            <div className="bg-red-50 border border-red-100 text-red-700 rounded-2xl p-4 text-sm leading-6">
              {error}
            </div>

            <button
              type="button"
              onClick={() =>
                router.push("/performer/invitations")
              }
              className="w-full mt-5 bg-black text-white rounded-2xl py-4 font-bold"
            >
              オファー一覧に戻る
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (!invitation) {
    return (
      <main className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-md mx-auto pt-4">
          <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-8 text-center">
            <div className="text-4xl mb-4">
              📭
            </div>

            <p className="text-gray-600">
              依頼情報が見つかりません。
            </p>

            <button
              type="button"
              onClick={() =>
                router.push("/performer/invitations")
              }
              className="w-full mt-6 bg-black text-white rounded-2xl py-4 font-bold"
            >
              オファー一覧に戻る
            </button>
          </div>
        </div>
      </main>
    );
  }

  const performanceRequest =
    invitation.performance_requests;

  const facility = performanceRequest.facilities;

  const formattedDate = new Date(
    `${performanceRequest.performance_date}T00:00:00`
  ).toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  });

  const statusLabel =
    invitation.status === "pending"
      ? "承諾待ち"
      : invitation.status === "accepted"
      ? "承諾済み"
      : invitation.status === "rejected"
      ? "辞退"
      : invitation.status;

  const processing =
    accepting || rejecting;

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-md mx-auto px-4 pt-4 pb-10">

        {/* 戻る */}
        <button
          type="button"
          onClick={() =>
            router.push("/performer/invitations")
          }
          className="inline-flex items-center text-sm font-bold text-gray-600 py-2 mb-3"
        >
          ← オファー一覧に戻る
        </button>

        {/* メインカード */}
        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">

          {/* ヘッダー */}
          <div className="bg-black text-white px-5 py-6">
            <div className="flex items-center justify-between gap-3 mb-3">
              <span className="text-xs font-bold tracking-wider text-gray-300">
                施設からのオファー
              </span>

              <span className="text-xs font-bold bg-white/10 border border-white/10 rounded-full px-3 py-1">
                {statusLabel}
              </span>
            </div>

            <h1 className="text-2xl font-bold leading-tight">
              {performanceRequest.title}
            </h1>
          </div>

          <div className="p-5 space-y-7">

            {/* エラー */}
            {error && (
              <div className="bg-red-50 border border-red-100 text-red-700 rounded-2xl p-4 text-sm leading-6">
                {error}
              </div>
            )}

            {/* 成功 */}
            {success && (
              <div className="bg-green-50 border border-green-100 text-green-700 rounded-2xl p-4 text-sm leading-6">
                {success}
              </div>
            )}

            {/* 依頼状況 */}
            <section>
              <p className="text-xs font-bold tracking-wider text-gray-400 mb-2">
                依頼状況
              </p>

              <span
                className={`inline-flex items-center rounded-full px-4 py-2 text-sm font-bold ${
                  invitation.status === "pending"
                    ? "bg-amber-50 text-amber-700"
                    : invitation.status === "accepted"
                    ? "bg-green-50 text-green-700"
                    : invitation.status === "rejected"
                    ? "bg-gray-100 text-gray-600"
                    : "bg-gray-100 text-gray-700"
                }`}
              >
                {invitation.status === "pending"
                  ? "● 承諾待ち"
                  : invitation.status === "accepted"
                  ? "✓ 承諾済み"
                  : invitation.status === "rejected"
                  ? "辞退済み"
                  : statusLabel}
              </span>
            </section>

            {/* 施設 */}
            <section>
              <p className="text-xs font-bold tracking-wider text-gray-400 mb-2">
                施設
              </p>

              <div className="rounded-2xl bg-gray-50 border border-gray-100 p-4">
                <div className="flex items-start gap-3">
                  <div className="w-11 h-11 rounded-2xl bg-white border border-gray-100 flex items-center justify-center text-xl shrink-0">
                    🏢
                  </div>

                  <div className="min-w-0">
                    <p className="text-lg font-bold text-gray-900">
                      {facility?.name || "施設名未設定"}
                    </p>

                    {facility?.facility_type && (
                      <p className="text-sm text-gray-500 mt-1">
                        {facility.facility_type}
                      </p>
                    )}

                    {facility?.address && (
                      <p className="text-sm text-gray-600 mt-2">
                        📍 {facility.address}
                      </p>
                    )}
                  </div>
                </div>

                {facility?.description && (
                  <div className="mt-4 pt-4 border-t border-gray-200">
                    <p className="text-sm text-gray-600 whitespace-pre-wrap leading-6">
                      {facility.description}
                    </p>
                  </div>
                )}
              </div>
            </section>

            {/* 演奏日時 */}
            <section>
              <p className="text-xs font-bold tracking-wider text-gray-400 mb-2">
                演奏日時
              </p>

              <div className="rounded-2xl bg-gray-50 border border-gray-100 p-4">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-2xl bg-white border border-gray-100 flex items-center justify-center text-xl shrink-0">
                    📅
                  </div>

                  <div>
                    <p className="font-bold text-gray-900">
                      {formattedDate}
                    </p>

                    <p className="text-gray-600 mt-1">
                      {performanceRequest.start_time.slice(0, 5)}
                      {" ～ "}
                      {performanceRequest.end_time.slice(0, 5)}
                    </p>
                  </div>
                </div>
              </div>
            </section>

            {/* エリア */}
            {performanceRequest.area && (
              <section>
                <p className="text-xs font-bold tracking-wider text-gray-400 mb-2">
                  エリア
                </p>

                <div className="rounded-2xl bg-gray-50 border border-gray-100 p-4 flex items-center gap-3">
                  <span className="text-xl">
                    📍
                  </span>

                  <span className="font-medium text-gray-800">
                    {performanceRequest.area}
                  </span>
                </div>
              </section>
            )}

            {/* 報酬 */}
            {performanceRequest.reward !== null && (
              <section>
                <p className="text-xs font-bold tracking-wider text-gray-400 mb-2">
                  報酬
                </p>

                <div className="rounded-2xl bg-gray-50 border border-gray-100 p-4">
                  <p className="text-xs text-gray-500 mb-1">
                    演奏報酬
                  </p>

                  <p className="text-2xl font-bold text-gray-900">
                    ¥
                    {performanceRequest.reward.toLocaleString()}
                  </p>
                </div>
              </section>
            )}

            {/* 希望楽器 */}
            {performanceRequest.instruments &&
              performanceRequest.instruments.length > 0 && (
                <section>
                  <p className="text-xs font-bold tracking-wider text-gray-400 mb-2">
                    希望楽器
                  </p>

                  <div className="flex flex-wrap gap-2">
                    {performanceRequest.instruments.map(
                      (instrument) => (
                        <span
                          key={instrument}
                          className="bg-gray-100 text-gray-700 rounded-full px-3 py-2 text-sm font-medium"
                        >
                          🎸 {instrument}
                        </span>
                      )
                    )}
                  </div>
                </section>
              )}

            {/* 希望ジャンル */}
            {performanceRequest.genres &&
              performanceRequest.genres.length > 0 && (
                <section>
                  <p className="text-xs font-bold tracking-wider text-gray-400 mb-2">
                    希望ジャンル
                  </p>

                  <div className="flex flex-wrap gap-2">
                    {performanceRequest.genres.map(
                      (genre) => (
                        <span
                          key={genre}
                          className="bg-gray-100 text-gray-700 rounded-full px-3 py-2 text-sm font-medium"
                        >
                          🎵 {genre}
                        </span>
                      )
                    )}
                  </div>
                </section>
              )}

            {/* 案件詳細 */}
            {performanceRequest.description && (
              <section>
                <p className="text-xs font-bold tracking-wider text-gray-400 mb-2">
                  案件詳細
                </p>

                <div className="rounded-2xl bg-gray-50 border border-gray-100 p-4">
                  <p className="whitespace-pre-wrap text-sm text-gray-700 leading-7">
                    {performanceRequest.description}
                  </p>
                </div>
              </section>
            )}

            {/* 施設からのメッセージ */}
            {invitation.message && (
              <section>
                <p className="text-xs font-bold tracking-wider text-gray-400 mb-2">
                  施設からのメッセージ
                </p>

                <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4">
                  <div className="flex items-start gap-3">
                    <span className="text-xl">
                      💬
                    </span>

                    <p className="flex-1 whitespace-pre-wrap text-sm text-gray-700 leading-7">
                      {invitation.message}
                    </p>
                  </div>
                </div>
              </section>
            )}

            {/* 承諾・辞退 */}
            {invitation.status === "pending" && (
              <div className="pt-1 space-y-3">
                <button
                  type="button"
                  onClick={handleAccept}
                  disabled={processing}
                  className="w-full bg-black text-white rounded-2xl py-4 font-bold shadow-sm disabled:opacity-50"
                >
                  {accepting
                    ? "承諾処理中..."
                    : "✓ この依頼を承諾する"}
                </button>

                <button
                  type="button"
                  onClick={handleReject}
                  disabled={processing}
                  className="w-full bg-white border border-gray-300 text-gray-700 rounded-2xl py-4 font-bold disabled:opacity-50"
                >
                  {rejecting
                    ? "辞退処理中..."
                    : "今回は見送る"}
                </button>

                <p className="text-center text-xs text-gray-400 pt-1">
                  承諾するとマッチングが成立します
                </p>
              </div>
            )}

            {/* 承諾済み */}
            {invitation.status === "accepted" && (
              <div className="pt-1">
                <div className="bg-green-50 border border-green-100 rounded-2xl p-4 mb-3">
                  <p className="text-sm font-bold text-green-700">
                    ✓ この依頼は承諾済みです
                  </p>

                  <p className="text-xs text-green-600 mt-1">
                    マッチング詳細から施設との連絡を確認できます。
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    router.push("/performer/matches")
                  }
                  className="w-full bg-black text-white rounded-2xl py-4 font-bold"
                >
                  マッチングを確認する
                </button>
              </div>
            )}

            {/* 辞退済み */}
            {invitation.status === "rejected" && (
              <div className="pt-1">
                <div className="bg-gray-100 text-gray-600 rounded-2xl p-4 text-center mb-3">
                  <p className="font-bold">
                    この依頼は辞退しました。
                  </p>

                  <p className="text-xs mt-1 text-gray-500">
                    オファー一覧からほかのオファーを確認できます。
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    router.push("/performer/invitations")
                  }
                  className="w-full bg-black text-white rounded-2xl py-4 font-bold"
                >
                  オファー一覧に戻る
                </button>
              </div>
            )}

            {/* ホーム */}
            <button
              type="button"
              onClick={() =>
                router.push("/performer/home")
              }
              disabled={processing}
              className="w-full text-gray-500 py-3 text-sm font-medium disabled:opacity-50"
            >
              演奏者ホームへ戻る
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}