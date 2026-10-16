"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import liff from "@line/liff";

type Invitation = {
  id: string;
  request_id: string;
  performer_id: string;
  message: string | null;
  status: string;
  source: string;
  created_at: string;
  request: {
    id: string;
    title: string;
    description: string | null;
    performance_date: string;
    start_time: string;
    end_time: string;
    area: string | null;
    reward: number | null;
    status: string;
  } | null;
  facility: {
    id: string;
    name: string | null;
    facility_type: string | null;
    address: string | null;
    description: string | null;
  } | null;
};

const PAGE_SIZE = 10;

export default function PerformerInvitationsPage() {
  const router = useRouter();

  const [lineUserId, setLineUserId] = useState("");
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const init = async () => {
      try {
        await liff.init({
          liffId: process.env.NEXT_PUBLIC_LIFF_ID!,
        });

        if (!liff.isLoggedIn()) {
          liff.login();
          return;
        }

        const profile = await liff.getProfile();

        setLineUserId(profile.userId);
        await loadInvitations(profile.userId);
      } catch (err) {
        console.error(err);
        setError("依頼情報の取得に失敗しました");
        setLoading(false);
      }
    };

    init();
  }, []);

  const loadInvitations = async (userId: string) => {
    try {
      setLoading(true);
      setError("");

      const response = await fetch("/api/performer/invitations", {
        headers: {
          "x-line-user-id": userId,
        },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "依頼情報の取得に失敗しました"
        );
      }

      setInvitations(data.invitations || []);
      setPage(1);
    } catch (err) {
      console.error(err);
      setError("依頼情報の取得に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  const totalPages = Math.ceil(invitations.length / PAGE_SIZE);

  const displayedInvitations = invitations.slice(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE
  );

  const goToPage = (nextPage: number) => {
    if (nextPage < 1 || nextPage > totalPages) {
      return;
    }

    setPage(nextPage);
    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  };

  const formatDate = (date: string) => {
    const parsedDate = new Date(date + "T00:00:00");

    return parsedDate.toLocaleDateString("ja-JP", {
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "short",
    });
  };

  const formatTime = (time: string) => {
    return time.slice(0, 5);
  };

  const getStatusLabel = (status: string) => {
    if (status === "pending") {
      return "未対応";
    }

    if (status === "accepted") {
      return "承諾済み";
    }

    if (status === "rejected") {
      return "辞退済み";
    }

    return status;
  };

  const getStatusClass = (status: string) => {
    if (status === "pending") {
      return "bg-amber-50 text-amber-700 border border-amber-200";
    }

    if (status === "accepted") {
      return "bg-green-50 text-green-700 border border-green-200";
    }

    if (status === "rejected") {
      return "bg-gray-100 text-gray-500 border border-gray-200";
    }

    return "bg-gray-100 text-gray-600 border border-gray-200";
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50">
        <div className="max-w-md mx-auto px-4 py-6">
          <div className="mb-6">
            <div className="h-4 w-16 bg-gray-200 rounded animate-pulse" />
            <div className="h-7 w-28 bg-gray-200 rounded mt-4 animate-pulse" />
            <div className="h-4 w-56 bg-gray-200 rounded mt-2 animate-pulse" />
          </div>

          <div className="space-y-4">
            {[1, 2].map((item) => (
              <div
                key={item}
                className="bg-white rounded-2xl p-5 shadow-sm"
              >
                <div className="flex justify-between gap-3">
                  <div className="flex-1">
                    <div className="h-5 w-3/4 bg-gray-200 rounded animate-pulse" />
                    <div className="h-4 w-1/2 bg-gray-100 rounded mt-3 animate-pulse" />
                  </div>
                  <div className="h-7 w-16 bg-gray-200 rounded-full animate-pulse" />
                </div>

                <div className="mt-5 space-y-3">
                  <div className="h-4 bg-gray-100 rounded animate-pulse" />
                  <div className="h-4 bg-gray-100 rounded animate-pulse" />
                  <div className="h-4 bg-gray-100 rounded animate-pulse" />
                </div>

                <div className="h-11 bg-gray-200 rounded-xl mt-5 animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-md mx-auto px-4 py-5 pb-8">
        {/* ヘッダー */}
        <header className="mb-6">
          <button
            onClick={() => router.push("/performer/home")}
            className="inline-flex items-center text-sm text-gray-500 hover:text-gray-900 transition"
          >
            ← 演奏者ホーム
          </button>

          <div className="mt-5">
            <p className="text-xs font-bold tracking-widest text-gray-400">
              INVITATIONS
            </p>

            <h1 className="text-2xl font-bold text-gray-900 mt-1">
              演奏依頼
            </h1>

            <p className="text-sm text-gray-500 mt-2">
              施設から届いた直接依頼を確認できます。
            </p>
          </div>
        </header>

        {/* エラー */}
        {error && (
          <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-4">
            <p className="text-sm font-medium text-red-700">{error}</p>
          </div>
        )}

        {/* 依頼件数 */}
        {invitations.length > 0 && (
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm text-gray-500">
              全 {invitations.length} 件
            </p>

            <p className="text-sm text-gray-500">
              {(page - 1) * PAGE_SIZE + 1}～
              {Math.min(page * PAGE_SIZE, invitations.length)} 件目
            </p>
          </div>
        )}

        {/* 依頼一覧 */}
        {invitations.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center shadow-sm">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 text-3xl">
              🎵
            </div>

            <h2 className="font-bold text-lg text-gray-900 mt-5">
              まだ演奏依頼はありません
            </h2>

            <p className="text-sm leading-6 text-gray-500 mt-2">
              施設から直接依頼が届くと、
              ここに表示されます。
            </p>

            <button
              onClick={() => router.push("/performer/requests")}
              className="w-full mt-6 bg-black text-white rounded-xl py-3.5 font-bold"
            >
              演奏依頼を探す
            </button>
          </div>
        ) : (
          <>
            <div className="space-y-4">
              {displayedInvitations.map((invitation) => (
                <article
                  key={invitation.id}
                  className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm"
                >
                  {/* タイトル・ステータス */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-gray-400 mb-1">
                        施設からの直接依頼
                      </p>

                      <h2 className="font-bold text-lg leading-7 text-gray-900 break-words">
                        {invitation.request?.title || "演奏依頼"}
                      </h2>
                    </div>

                    <span
                      className={
                        "shrink-0 px-3 py-1.5 rounded-full text-xs font-bold " +
                        getStatusClass(invitation.status)
                      }
                    >
                      {getStatusLabel(invitation.status)}
                    </span>
                  </div>

                  {/* 基本情報 */}
                  <div className="mt-5 rounded-xl bg-gray-50 p-4 space-y-4">
                    <div>
                      <p className="text-xs text-gray-400">施設</p>

                      <p className="font-semibold text-gray-900 mt-1">
                        {invitation.facility?.name || "施設名未設定"}
                      </p>

                      {invitation.facility?.facility_type && (
                        <p className="text-xs text-gray-500 mt-1">
                          {invitation.facility.facility_type}
                        </p>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs text-gray-400">演奏日</p>

                        <p className="text-sm font-medium text-gray-900 mt-1 leading-5">
                          {invitation.request
                            ? formatDate(
                                invitation.request.performance_date
                              )
                            : "-"}
                        </p>
                      </div>

                      <div>
                        <p className="text-xs text-gray-400">時間</p>

                        <p className="text-sm font-medium text-gray-900 mt-1">
                          {invitation.request
                            ? formatTime(invitation.request.start_time) +
                              " ～ " +
                              formatTime(invitation.request.end_time)
                            : "-"}
                        </p>
                      </div>
                    </div>

                    <div>
                      <p className="text-xs text-gray-400">場所</p>

                      <p className="text-sm font-medium text-gray-900 mt-1">
                        {invitation.request?.area || "未設定"}
                      </p>
                    </div>

                    {invitation.request?.reward !== null &&
                      invitation.request?.reward !== undefined && (
                        <div className="pt-3 border-t border-gray-200">
                          <p className="text-xs text-gray-400">謝礼</p>

                          <p className="text-lg font-bold text-gray-900 mt-1">
                            ¥
                            {invitation.request.reward.toLocaleString()}
                          </p>
                        </div>
                      )}
                  </div>

                  {/* 施設メッセージ */}
                  {invitation.message && (
                    <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
                      <p className="text-xs font-medium text-gray-400 mb-2">
                        施設からのメッセージ
                      </p>

                      <p className="text-sm leading-6 text-gray-700 whitespace-pre-wrap break-words">
                        {invitation.message}
                      </p>
                    </div>
                  )}

                  {/* 詳細ボタン */}
                  <button
                    onClick={() =>
                      router.push(
                        "/performer/invitations/" + invitation.id
                      )
                    }
                    className="w-full mt-5 bg-black text-white rounded-xl py-3.5 font-bold hover:bg-gray-800 transition"
                  >
                    依頼を確認する
                  </button>
                </article>
              ))}
            </div>

            {/* ページ切り替え */}
            {totalPages > 1 && (
              <div className="mt-5 flex items-center justify-between gap-3">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => goToPage(page - 1)}
                  className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  ← 前へ
                </button>

                <span className="text-center text-sm text-gray-600">
                  {page} / {totalPages} ページ
                </span>

                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => goToPage(page + 1)}
                  className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  次へ →
                </button>
              </div>
            )}
          </>
        )}

        {/* ホームへ */}
        {invitations.length > 0 && (
          <button
            onClick={() => router.push("/performer/home")}
            className="w-full mt-6 border border-gray-200 bg-white text-gray-700 rounded-xl py-3.5 font-medium hover:bg-gray-50 transition"
          >
            演奏者ホームへ戻る
          </button>
        )}
      </div>
    </main>
  );
}