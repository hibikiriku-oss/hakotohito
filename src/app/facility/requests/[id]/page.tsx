"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import liff from "@line/liff";

type User = {
  display_name: string | null;
  picture_url: string | null;
};

type Performer = {
  id: string;
  name: string | null;
  area: string | null;
  instruments: string[];
  genres: string[];
  bio: string | null;
  users: User | null;
};

type Application = {
  id: string;
  message: string | null;
  status: string;
  created_at: string;
  performers: Performer | null;
};

type PerformanceRequest = {
  id: string;
  title: string;
};

export default function FacilityApplicationsPage() {
  const params = useParams();
  const router = useRouter();

  const requestId = params.id as string;

  const [lineUserId, setLineUserId] =
    useState("");

  const [performanceRequest, setPerformanceRequest] =
    useState<PerformanceRequest | null>(null);

  const [applications, setApplications] =
    useState<Application[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [acceptingApplicationId, setAcceptingApplicationId] =
    useState<string | null>(null);

  const [error, setError] =
    useState("");

  async function loadApplications(
    userId: string
  ) {
    const response = await fetch(
      `/api/facility/requests/${requestId}/applications`,
      {
        headers: {
          "x-line-user-id": userId,
        },
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.error ||
          "応募者の取得に失敗しました"
      );
    }

    setPerformanceRequest(data.request);
    setApplications(data.applications || []);
  }

  useEffect(() => {
    async function initialize() {
      try {
        const liffId =
          process.env.NEXT_PUBLIC_LIFF_ID;

        if (!liffId) {
          throw new Error(
            "NEXT_PUBLIC_LIFF_IDが設定されていません"
          );
        }

        await liff.init({
          liffId,
          withLoginOnExternalBrowser: true,
        });

        if (!liff.isLoggedIn()) {
          liff.login();
          return;
        }

        const profile =
          await liff.getProfile();

        setLineUserId(profile.userId);

        await loadApplications(
          profile.userId
        );

      } catch (error) {
        console.error(
          "応募者取得エラー:",
          error
        );

        setError(
          error instanceof Error
            ? error.message
            : "応募者の取得に失敗しました"
        );

      } finally {
        setLoading(false);
      }
    }

    initialize();
  }, [requestId]);

  async function handleAccept(
    application: Application
  ) {
    const performer =
      application.performers;

    if (!performer) {
      return;
    }

    const performerName =
      performer.name ||
      performer.users?.display_name ||
      "この演奏者";

    const confirmed = window.confirm(
      `${performerName}さんに演奏を依頼しますか？\n\n採用すると、この案件の他の応募者は見送りになります。`
    );

    if (!confirmed) {
      return;
    }

    try {
      setAcceptingApplicationId(
        application.id
      );

      const response = await fetch(
        `/api/facility/requests/${requestId}/applications/${application.id}/accept`,
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
          data.error ||
            "採用処理に失敗しました"
        );
      }

      alert(
        "マッチングが成立しました！"
      );

      await loadApplications(
        lineUserId
      );

    } catch (error) {
      console.error(
        "採用処理エラー:",
        error
      );

      alert(
        error instanceof Error
          ? error.message
          : "採用処理に失敗しました"
      );

    } finally {
      setAcceptingApplicationId(null);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-md mx-auto">

          <h1 className="text-2xl font-bold">
            👥 応募者一覧
          </h1>

          <p className="mt-8 text-center text-gray-500">
            応募者を読み込んでいます…
          </p>

        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-md mx-auto">

          <h1 className="text-2xl font-bold">
            👥 応募者一覧
          </h1>

          <div className="mt-6 p-4 bg-red-50 rounded-xl">
            <p className="text-red-600">
              {error}
            </p>
          </div>

          <button
            onClick={() =>
              router.push(
                "/facility/requests"
              )
            }
            className="w-full mt-6 bg-white border rounded-xl p-4"
          >
            ← 依頼一覧へ戻る
          </button>

        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-md mx-auto">

        <button
          onClick={() =>
            router.push(
              "/facility/requests"
            )
          }
          className="text-sm text-gray-500 mb-4"
        >
          ← 依頼一覧へ戻る
        </button>

        <h1 className="text-2xl font-bold">
          👥 応募者一覧
        </h1>

        {performanceRequest && (
          <p className="mt-2 text-gray-600">
            {performanceRequest.title}
          </p>
        )}

        {applications.length === 0 ? (
          <div className="mt-6 bg-white rounded-2xl p-6 text-center">

            <p className="text-gray-500">
              まだ応募者はいません。
            </p>

          </div>
        ) : (
          <div className="mt-6 space-y-4">

            {applications.map((application) => {
              const performer =
                application.performers;

              if (!performer) {
                return null;
              }

              const performerName =
                performer.name ||
                performer.users?.display_name ||
                "名前未登録";

              return (
                <div
                  key={application.id}
                  className="bg-white rounded-2xl p-5 shadow-sm border"
                >

                  <div className="flex items-start gap-4">

                    {performer.users?.picture_url ? (
                      <img
                        src={
                          performer.users.picture_url
                        }
                        alt=""
                        className="w-14 h-14 rounded-full object-cover"
                      />
                    ) : (
                      <div className="w-14 h-14 rounded-full bg-gray-200 flex items-center justify-center">
                        🎸
                      </div>
                    )}

                    <div className="flex-1">

                      <h2 className="text-lg font-bold">
                        {performerName}
                      </h2>

                      {performer.area && (
                        <p className="text-sm text-gray-600 mt-1">
                          📍 {performer.area}
                        </p>
                      )}

                    </div>

                    <span
                      className={
                        application.status ===
                        "pending"
                          ? "text-xs bg-yellow-100 text-yellow-700 rounded-full px-3 py-1"
                          : application.status ===
                            "accepted"
                            ? "text-xs bg-green-100 text-green-700 rounded-full px-3 py-1"
                            : "text-xs bg-gray-100 text-gray-500 rounded-full px-3 py-1"
                      }
                    >
                      {application.status ===
                      "pending"
                        ? "応募中"
                        : application.status ===
                          "accepted"
                          ? "採用"
                          : "見送り"}
                    </span>

                  </div>

                  {performer.instruments?.length >
                    0 && (
                    <div className="mt-4">

                      <p className="text-sm text-gray-500">
                        楽器
                      </p>

                      <div className="flex flex-wrap gap-2 mt-2">

                        {performer.instruments.map(
                          (instrument) => (
                            <span
                              key={instrument}
                              className="text-sm bg-gray-100 rounded-full px-3 py-1"
                            >
                              🎵 {instrument}
                            </span>
                          )
                        )}

                      </div>

                    </div>
                  )}

                  {performer.genres?.length >
                    0 && (
                    <div className="mt-4">

                      <p className="text-sm text-gray-500">
                        ジャンル
                      </p>

                      <div className="flex flex-wrap gap-2 mt-2">

                        {performer.genres.map(
                          (genre) => (
                            <span
                              key={genre}
                              className="text-sm bg-gray-100 rounded-full px-3 py-1"
                            >
                              🎼 {genre}
                            </span>
                          )
                        )}

                      </div>

                    </div>
                  )}

                  {performer.bio && (
                    <div className="mt-4">

                      <p className="text-sm text-gray-500">
                        自己紹介
                      </p>

                      <p className="mt-1 text-sm whitespace-pre-wrap">
                        {performer.bio}
                      </p>

                    </div>
                  )}

                  {application.message && (
                    <div className="mt-4 bg-gray-50 rounded-xl p-4">

                      <p className="text-sm text-gray-500">
                        応募メッセージ
                      </p>

                      <p className="mt-2 text-sm whitespace-pre-wrap">
                        {application.message}
                      </p>

                    </div>
                  )}

                  {/* 採用ボタン */}
                  {application.status ===
                    "pending" && (
                    <button
                      onClick={() =>
                        handleAccept(
                          application
                        )
                      }
                      disabled={
                        acceptingApplicationId ===
                        application.id
                      }
                      className="w-full mt-5 bg-black text-white rounded-xl p-4 font-bold disabled:opacity-50"
                    >
                      {acceptingApplicationId ===
                      application.id
                        ? "採用処理中..."
                        : "🎵 この演奏者に依頼する"}
                    </button>
                  )}

                </div>
              );
            })}

          </div>
        )}

        <button
          onClick={() =>
            router.push(
              "/facility/requests"
            )
          }
          className="w-full mt-6 bg-white border rounded-xl p-4"
        >
          ← 依頼一覧へ戻る
        </button>

      </div>
    </main>
  );
}