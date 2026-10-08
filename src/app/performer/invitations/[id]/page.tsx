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

  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [lineUserId, setLineUserId] = useState("");
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
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

      setSuccess("依頼を承諾しました。マッチングが成立しました！");

      // 少しだけ成功メッセージを表示してから
      // マッチング詳細画面へ移動
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

  function handleReject() {
    window.alert(
      "辞退処理は次のステップで追加します。"
    );
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-lg mx-auto">
          <div className="bg-white rounded-2xl p-6 shadow-sm text-center">
            <p className="text-gray-600">
              依頼情報を読み込んでいます...
            </p>
          </div>
        </div>
      </main>
    );
  }

  if (error && !invitation) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-lg mx-auto">
          <div className="bg-white rounded-2xl p-6 shadow-sm">
            <h1 className="text-xl font-bold mb-4">
              依頼詳細
            </h1>

            <div className="bg-red-50 text-red-700 rounded-xl p-4 mb-6">
              {error}
            </div>

            <button
              type="button"
              onClick={() => router.push("/performer/invitations")}
              className="w-full bg-gray-200 text-gray-800 rounded-xl p-4 font-bold"
            >
              依頼一覧に戻る
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (!invitation) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-lg mx-auto">
          <div className="bg-white rounded-2xl p-6 shadow-sm text-center">
            <p className="text-gray-600">
              依頼情報が見つかりません。
            </p>
          </div>
        </div>
      </main>
    );
  }

  const request = invitation.performance_requests;
  const facility = request.facilities;

  const formattedDate = new Date(
    `${request.performance_date}T00:00:00`
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

  return (
    <main className="min-h-screen bg-gray-50 p-4 pb-10">
      <div className="max-w-lg mx-auto">
        <button
          type="button"
          onClick={() => router.push("/performer/invitations")}
          className="text-gray-600 mb-4"
        >
          ← 依頼一覧に戻る
        </button>

        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <div className="bg-blue-600 text-white p-6">
            <p className="text-sm opacity-90 mb-2">
              施設からの演奏依頼
            </p>

            <h1 className="text-2xl font-bold">
              {request.title}
            </h1>
          </div>

          <div className="p-6 space-y-6">
            {error && (
              <div className="bg-red-50 text-red-700 rounded-xl p-4">
                {error}
              </div>
            )}

            {success && (
              <div className="bg-green-50 text-green-700 rounded-xl p-4">
                {success}
              </div>
            )}

            <section>
              <h2 className="text-sm font-bold text-gray-500 mb-2">
                依頼状況
              </h2>

              <div className="inline-block bg-yellow-100 text-yellow-800 rounded-full px-4 py-2 font-bold">
                {statusLabel}
              </div>
            </section>

            <section>
              <h2 className="text-sm font-bold text-gray-500 mb-2">
                施設
              </h2>

              <div className="border rounded-xl p-4">
                <p className="text-lg font-bold">
                  {facility?.name || "施設名未設定"}
                </p>

                {facility?.facility_type && (
                  <p className="text-gray-600 mt-1">
                    {facility.facility_type}
                  </p>
                )}

                {facility?.address && (
                  <p className="text-gray-600 mt-2">
                    📍 {facility.address}
                  </p>
                )}

                {facility?.description && (
                  <p className="text-gray-600 mt-3 whitespace-pre-wrap">
                    {facility.description}
                  </p>
                )}
              </div>
            </section>

            <section>
              <h2 className="text-sm font-bold text-gray-500 mb-2">
                演奏日時
              </h2>

              <div className="border rounded-xl p-4">
                <p className="font-bold text-lg">
                  {formattedDate}
                </p>

                <p className="text-gray-700 mt-2">
                  {request.start_time.slice(0, 5)}
                  {" ～ "}
                  {request.end_time.slice(0, 5)}
                </p>
              </div>
            </section>

            {request.area && (
              <section>
                <h2 className="text-sm font-bold text-gray-500 mb-2">
                  エリア
                </h2>

                <div className="border rounded-xl p-4">
                  📍 {request.area}
                </div>
              </section>
            )}

            {request.reward !== null && (
              <section>
                <h2 className="text-sm font-bold text-gray-500 mb-2">
                  報酬
                </h2>

                <div className="border rounded-xl p-4">
                  <p className="text-xl font-bold">
                    ¥{request.reward.toLocaleString()}
                  </p>
                </div>
              </section>
            )}

            {request.instruments &&
              request.instruments.length > 0 && (
                <section>
                  <h2 className="text-sm font-bold text-gray-500 mb-2">
                    希望楽器
                  </h2>

                  <div className="flex flex-wrap gap-2">
                    {request.instruments.map((instrument) => (
                      <span
                        key={instrument}
                        className="bg-gray-100 rounded-full px-3 py-2 text-sm"
                      >
                        {instrument}
                      </span>
                    ))}
                  </div>
                </section>
              )}

            {request.genres &&
              request.genres.length > 0 && (
                <section>
                  <h2 className="text-sm font-bold text-gray-500 mb-2">
                    希望ジャンル
                  </h2>

                  <div className="flex flex-wrap gap-2">
                    {request.genres.map((genre) => (
                      <span
                        key={genre}
                        className="bg-gray-100 rounded-full px-3 py-2 text-sm"
                      >
                        {genre}
                      </span>
                    ))}
                  </div>
                </section>
              )}

            {request.description && (
              <section>
                <h2 className="text-sm font-bold text-gray-500 mb-2">
                  案件詳細
                </h2>

                <div className="border rounded-xl p-4 whitespace-pre-wrap text-gray-700">
                  {request.description}
                </div>
              </section>
            )}

            {invitation.message && (
              <section>
                <h2 className="text-sm font-bold text-gray-500 mb-2">
                  施設からのメッセージ
                </h2>

                <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 whitespace-pre-wrap">
                  {invitation.message}
                </div>
              </section>
            )}

            {invitation.status === "pending" && (
              <div className="pt-2 space-y-3">
                <button
                  type="button"
                  onClick={handleAccept}
                  disabled={accepting}
                  className="w-full bg-green-600 text-white rounded-xl p-4 font-bold disabled:opacity-50"
                >
                  {accepting
                    ? "承諾処理中..."
                    : "✓ この依頼を承諾する"}
                </button>

                <button
                  type="button"
                  onClick={handleReject}
                  disabled={accepting}
                  className="w-full bg-gray-200 text-gray-800 rounded-xl p-4 font-bold disabled:opacity-50"
                >
                  今回は見送る
                </button>
              </div>
            )}

            {invitation.status === "accepted" && (
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() =>
                    router.push("/performer/matches")
                  }
                  className="w-full bg-blue-600 text-white rounded-xl p-4 font-bold"
                >
                  マッチングを確認する
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={() => router.push("/performer/home")}
              className="w-full text-gray-600 p-3"
            >
              演奏者ホームへ戻る
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}