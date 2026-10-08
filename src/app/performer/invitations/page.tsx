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

export default function PerformerInvitationsPage() {
  const router = useRouter();

  const [lineUserId, setLineUserId] = useState("");
  const [invitations, setInvitations] = useState<
    Invitation[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const init = async () => {
      try {
        await liff.init({
          liffId:
            process.env.NEXT_PUBLIC_LIFF_ID!,
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
        setError(
          "依頼情報の取得に失敗しました"
        );
        setLoading(false);
      }
    };

    init();
  }, []);

  const loadInvitations = async (
    userId: string
  ) => {
    try {
      setLoading(true);
      setError("");

      const response = await fetch(
        "/api/performer/invitations",
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
            "依頼情報の取得に失敗しました"
        );
      }

      setInvitations(data.invitations || []);
    } catch (err) {
      console.error(err);
      setError(
        "依頼情報の取得に失敗しました"
      );
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (date: string) => {
    const parsedDate = new Date(
      date + "T00:00:00"
    );

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
      return "bg-yellow-100 text-yellow-800";
    }

    if (status === "accepted") {
      return "bg-green-100 text-green-800";
    }

    if (status === "rejected") {
      return "bg-gray-100 text-gray-600";
    }

    return "bg-gray-100 text-gray-600";
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-md mx-auto">
          <p className="text-center text-gray-600">
            依頼を読み込んでいます...
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-md mx-auto">
        <div className="flex items-center justify-between mb-6">
          <button
            onClick={() =>
              router.push("/performer/home")
            }
            className="text-gray-600"
          >
            ← 戻る
          </button>

          <h1 className="text-xl font-bold">
            演奏依頼
          </h1>

          <div className="w-10" />
        </div>

        {error && (
          <div className="bg-red-50 text-red-700 rounded-xl p-4 mb-4">
            {error}
          </div>
        )}

        {invitations.length === 0 ? (
          <div className="bg-white rounded-2xl p-8 text-center shadow-sm">
            <div className="text-4xl mb-4">
              🎵
            </div>

            <h2 className="font-bold text-lg mb-2">
              まだ演奏依頼はありません
            </h2>

            <p className="text-gray-500 text-sm">
              施設から直接依頼が届くと、
              ここに表示されます。
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {invitations.map((invitation) => (
              <div
                key={invitation.id}
                className="bg-white rounded-2xl p-5 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3 mb-3">
                  <h2 className="font-bold text-lg">
                    {invitation.request?.title ||
                      "演奏依頼"}
                  </h2>

                  <span
                    className={
                      "shrink-0 px-3 py-1 rounded-full text-xs font-medium " +
                      getStatusClass(
                        invitation.status
                      )
                    }
                  >
                    {getStatusLabel(
                      invitation.status
                    )}
                  </span>
                </div>

                <div className="border-t pt-3 space-y-2 text-sm">
                  <div>
                    <span className="text-gray-500">
                      施設
                    </span>
                    <p className="font-medium">
                      {invitation.facility?.name ||
                        "施設名未設定"}
                    </p>
                  </div>

                  <div>
                    <span className="text-gray-500">
                      演奏日
                    </span>
                    <p>
                      {invitation.request
                        ? formatDate(
                            invitation.request
                              .performance_date
                          )
                        : "-"}
                    </p>
                  </div>

                  <div>
                    <span className="text-gray-500">
                      時間
                    </span>
                    <p>
                      {invitation.request
                        ? formatTime(
                            invitation.request
                              .start_time
                          ) +
                          " ～ " +
                          formatTime(
                            invitation.request
                              .end_time
                          )
                        : "-"}
                    </p>
                  </div>

                  <div>
                    <span className="text-gray-500">
                      場所
                    </span>
                    <p>
                      {invitation.request
                        ?.area || "未設定"}
                    </p>
                  </div>

                  {invitation.request
                    ?.reward !== null &&
                    invitation.request
                      ?.reward !== undefined && (
                      <div>
                        <span className="text-gray-500">
                          謝礼
                        </span>
                        <p className="font-medium">
                          ¥
                          {invitation.request.reward.toLocaleString()}
                        </p>
                      </div>
                    )}
                </div>

                {invitation.message && (
                  <div className="mt-4 bg-gray-50 rounded-xl p-4">
                    <p className="text-xs text-gray-500 mb-1">
                      施設からのメッセージ
                    </p>

                    <p className="text-sm whitespace-pre-wrap">
                      {invitation.message}
                    </p>
                  </div>
                )}

                <button
                  onClick={() =>
                    router.push(
                      "/performer/invitations/" +
                        invitation.id
                    )
                  }
                  className="w-full mt-4 bg-black text-white rounded-xl py-3 font-medium"
                >
                  依頼を確認する
                </button>
              </div>
            ))}
          </div>
        )}

        <button
          onClick={() =>
            router.push("/performer/home")
          }
          className="w-full mt-6 border border-gray-300 bg-white rounded-xl py-3"
        >
          演奏者ホームへ戻る
        </button>
      </div>
    </main>
  );
}