"use client";

import { requireLineIdToken } from "@/lib/require-line-id-token";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import liff from "@line/liff";

type Match = {
  id: string;
  request_id: string;
  performer_id: string;
  matched_at: string;
  status: string;
  performance_status: "scheduled" | "completed" | "cancelled";
  completed_at: string | null;
  performer_completion_reported_at: string | null;
  facility_completion_reported_at: string | null;
  completion_disputed_at: string | null;
  completion_disputed_by: string | null;
  completion_dispute_reason: string | null;
  completion_dispute_facility_agreed_at: string | null;
  completion_dispute_performer_agreed_at: string | null;
  completion_method: string | null;
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

function getRequest(request: Match["performance_requests"] | undefined) {
  return Array.isArray(request) ? request[0] : request;
}

function getPerformer(performer: Match["performers"] | undefined) {
  return Array.isArray(performer) ? performer[0] : performer;
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
  return Array.isArray(users) ? users[0] : users;
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

function formatDateTime(date: string) {
  const value = new Date(date);
  return (
    value.getFullYear() +
    "年" +
    (value.getMonth() + 1) +
    "月" +
    value.getDate() +
    "日 " +
    value.getHours() +
    ":" +
    String(value.getMinutes()).padStart(2, "0")
  );
}

export default function FacilityMatchDetailPage() {
  const router = useRouter();
  const params = useParams();
  const matchId = params.id as string;

  const [match, setMatch] = useState<Match | null>(null);
  const [application, setApplication] = useState<Application | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [reportingCompletion, setReportingCompletion] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [agreeingDispute, setAgreeingDispute] = useState(false);

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

        const idToken = liff.getIDToken();

        if (!idToken) {
          throw new Error(
            "LINEの本人確認情報を取得できませんでした。再ログインしてください。"
          );
        }

        const response = await fetch(
          "/api/facility/matches/" + matchId,
          {
            headers: {
              Authorization: `Bearer ${idToken}`,
            },
          }
        );

        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            data.error || "マッチング情報の取得に失敗しました"
          );
        }

        setMatch(data.match);
        setApplication(data.application || null);

        const reviewResponse = await fetch(
          "/api/reviews?match_id=" + matchId,
          {
            headers: {
              Authorization: `Bearer ${idToken}`,
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
          err instanceof Error ? err.message : "エラーが発生しました"
        );
      } finally {
        setLoading(false);
      }
    }

    loadMatch();
  }, [matchId]);

  async function handleComplete() {
    if (!match || reportingCompletion) return;

    const confirmed = window.confirm(
      "演奏完了を報告しますか？\n\n双方の報告がそろうと、演奏完了が確定します。"
    );

    if (!confirmed) return;

    try {
      setReportingCompletion(true);
      setError("");
      setNotice("");

      const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
      if (!liffId) {
        throw new Error("LINE MINI Appの設定がありません");
      }

      if (!liff.isLoggedIn()) {
        liff.login();
        return;
      }

      const idToken = liff.getIDToken();

      if (!idToken) {
        throw new Error(
          "LINEの本人確認情報を取得できませんでした。再ログインしてください。"
        );
      }

      const response = await fetch(
        `/api/facility/matches/${matchId}/complete`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${idToken}`,
          },
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "演奏完了の報告に失敗しました"
        );
      }

      if (data.completed) {
        setNotice("双方の報告がそろい、演奏完了が確定しました。");
      } else {
        setNotice(
          data.message ||
            "演奏完了を報告しました。演奏者側の確認を待っています。"
        );
      }

      // APIから最新のマッチング状態を取得する
      const refreshResponse = await fetch(
        `/api/facility/matches/${matchId}`,
        {
          headers: {
            Authorization: `Bearer ${requireLineIdToken(liff.getIDToken())}`,
          },
        }
      );

      const refreshData = await refreshResponse.json();

      if (!refreshResponse.ok) {
        throw new Error(
          refreshData.error || "最新の演奏状況を取得できませんでした"
        );
      }

      setMatch(refreshData.match);
    } catch (err) {
      console.error("演奏完了報告エラー:", err);
      setError(
        err instanceof Error
          ? err.message
          : "演奏完了の報告に失敗しました"
      );
    } finally {
      setReportingCompletion(false);
    }
  }

  async function handleAgreeDispute() {
    if (!match || agreeingDispute) return;

    if (
      match.completion_dispute_facility_agreed_at
    ) {
      setNotice("施設側はすでに同意済みです。演奏者側の同意を待っています。");
      return;
    }

    const confirmed = window.confirm(
      "異議申し立ての取り下げに同意しますか？\n\n双方が同意すると異議申し立てが解除され、演奏完了の報告を再開できます。\n\n一度同意すると、現在の仕組みでは取り消せません。内容を確認してから同意してください。"
    );

    if (!confirmed) return;

    try {
      setAgreeingDispute(true);
      setError("");
      setNotice("");

      const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
      if (!liffId) {
        throw new Error("LINE MINI Appの設定がありません");
      }

      if (!liff.isLoggedIn()) {
        liff.login();
        return;
      }

      const idToken = liff.getIDToken();

      if (!idToken) {
        throw new Error("LINEの本人確認情報を取得できませんでした。再ログインしてください。");
      }

      const response = await fetch(
        `/api/facility/matches/${matchId}/dispute/agree`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${idToken}`,
          },
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "取り下げへの同意に失敗しました"
        );
      }

      setNotice(
        data.message ||
          "同意を記録しました。相手側の同意を待っています。"
      );

      const refreshResponse = await fetch(
        `/api/facility/matches/${matchId}`,
        {
          headers: {
            Authorization: `Bearer ${idToken}`,
          },
        }
      );

      const refreshData = await refreshResponse.json();

      if (!refreshResponse.ok) {
        throw new Error(
          refreshData.error ||
            "最新の演奏状況を取得できませんでした"
        );
      }

      setMatch(refreshData.match);
    } catch (err) {
      console.error("異議申し立て取り下げ同意エラー:", err);
      setError(
        err instanceof Error
          ? err.message
          : "取り下げへの同意に失敗しました"
      );
    } finally {
      setAgreeingDispute(false);
    }
  }

  async function handleCancel() {
    if (!match) return;

    const confirmed = window.confirm(
      "このマッチングをキャンセルしますか？\n\nキャンセルすると、この演奏予定は取り消されます。"
    );

    if (!confirmed) return;

    try {
      setCancelling(true);
      setError("");
      setNotice("");

      const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
      if (!liffId) {
        throw new Error("LINE MINI Appの設定がありません");
      }

      if (!liff.isLoggedIn()) {
        liff.login();
        return;
      }

      const idToken = liff.getIDToken();

      if (!idToken) {
        throw new Error("LINEの本人確認情報を取得できませんでした。再ログインしてください。");
      }

      const response = await fetch(
        `/api/facility/matches/${matchId}/cancel`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${idToken}`,
          },
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "マッチングのキャンセルに失敗しました"
        );
      }

      setMatch((currentMatch) => {
        if (!currentMatch) return currentMatch;
        return {
          ...currentMatch,
          status: "cancelled",
          performance_status: "cancelled",
        };
      });
    } catch (err) {
      console.error("マッチングキャンセル処理エラー:", err);
      setError(
        err instanceof Error
          ? err.message
          : "マッチングのキャンセルに失敗しました"
      );
    } finally {
      setCancelling(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-md mx-auto">
          <p className="text-gray-600">読み込み中...</p>
        </div>
      </main>
    );
  }

  if (error && !match) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-md mx-auto">
          <h1 className="text-xl font-bold">エラー</h1>
          <p className="mt-4 text-red-600">{error}</p>
          <button
            onClick={() => router.push("/facility/matches")}
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
          <p>マッチング情報が見つかりません。</p>
        </div>
      </main>
    );
  }

  const performanceRequest = getRequest(match.performance_requests);
  const performer = getPerformer(match.performers);
  const lineUser = getUser(performer?.users);

  const isCompleted = match.performance_status === "completed";
  const isCancelled = match.performance_status === "cancelled";
  const isDisputed = Boolean(match.completion_disputed_at);
  const facilityReported = Boolean(match.facility_completion_reported_at);
  const performerReported = Boolean(match.performer_completion_reported_at);

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-md mx-auto">
        <button
          onClick={() => router.push("/facility/matches")}
          className="text-gray-600 mb-4"
        >
          ← マッチング一覧に戻る
        </button>

        <div className="bg-white rounded-2xl p-6 shadow-sm">
          <div className="text-center">
            <div className="text-4xl">
              {isCancelled ? "⚠️" : "🎉"}
            </div>
            <h1 className="text-2xl font-bold mt-2">
              {isCancelled ? "キャンセル済み" : "マッチング成立"}
            </h1>
            <p
              className={`mt-2 font-medium ${
                isCancelled ? "text-gray-500" : "text-green-600"
              }`}
            >
              {isCancelled
                ? "この演奏予定はキャンセルされています"
                : "演奏者とのマッチングが成立しています"}
            </p>
          </div>

          {!isCancelled && (
            <section className="mt-6">
              <button
                onClick={() =>
                  router.push(`/facility/matches/${matchId}/chat`)
                }
                className="w-full bg-black text-white rounded-xl p-4 font-bold"
              >
                💬 演奏者とチャットする
              </button>
              <p className="mt-2 text-xs text-gray-400 text-center">
                演奏に関する連絡や確認を行えます。
              </p>
            </section>
          )}

          <section className="mt-8 bg-gray-50 rounded-2xl p-5 border">
            <h2 className="text-lg font-bold">🎵 演奏状況</h2>

            {isCompleted ? (
              <div className="mt-4 bg-white rounded-xl p-4">
                <p className="text-green-600 font-bold">
                  ✅ 演奏完了
                </p>
                {match.completed_at && (
                  <p className="mt-2 text-sm text-gray-500">
                    完了日時：{formatDateTime(match.completed_at)}
                  </p>
                )}
                <div className="mt-4 space-y-3 text-sm">
                  <p className="text-green-700">
                    施設側：報告済み
                    {match.facility_completion_reported_at &&
                      `（${formatDateTime(match.facility_completion_reported_at)}）`}
                  </p>
                  <p className="text-green-700">
                    演奏者側：報告済み
                    {match.performer_completion_reported_at &&
                      `（${formatDateTime(match.performer_completion_reported_at)}）`}
                  </p>
                </div>
                <p className="mt-3 text-sm text-gray-600">
                  双方の報告がそろい、演奏完了が確定しています。
                </p>
              </div>
            ) : isCancelled ? (
              <div className="mt-4 bg-white rounded-xl p-4">
                <p className="text-gray-600 font-bold">キャンセル済み</p>
                <p className="mt-2 text-sm text-gray-500">
                  このマッチングでの演奏予定はキャンセルされています。
                </p>
              </div>
            ) : isDisputed ? (
              <>
                <div className="mt-4 bg-amber-50 border border-amber-200 rounded-xl p-4">
                  <p className="font-bold text-amber-800">
                    ⚠️ 演奏完了について異議申し立て中
                  </p>
                  <p className="mt-2 text-sm text-gray-700">
                    異議申し立てが行われているため、完了報告はできません。
                    内容を確認し、当事者間でご相談ください。
                  </p>
                  {match.completion_dispute_reason && (
                    <div className="mt-3">
                      <p className="text-sm font-medium">申し立て理由</p>
                      <p className="mt-1 text-sm whitespace-pre-wrap">
                        {match.completion_dispute_reason}
                      </p>
                    </div>
                  )}
                </div>
                <div className="mt-4 rounded-xl bg-white border border-amber-200 p-4">
                    <p className="font-bold text-gray-800">
                      🤝 取り下げへの同意状況
                    </p>

                    <p className="mt-3 text-sm">
                      施設側：
                      {match.completion_dispute_facility_agreed_at ? (
                        <span className="text-green-700 font-bold">
                          ✅ 同意済み
                        </span>
                      ) : (
                        <span className="text-gray-500">
                          未同意
                        </span>
                      )}
                    </p>

                    <p className="mt-2 text-sm">
                      演奏者側：
                      {match.completion_dispute_performer_agreed_at ? (
                        <span className="text-green-700 font-bold">
                          ✅ 同意済み
                        </span>
                      ) : (
                        <span className="text-gray-500">
                          未同意
                        </span>
                      )}
                    </p>

                    {match.completion_dispute_facility_agreed_at ? (
                      <div className="mt-4 rounded-lg bg-green-50 p-3">
                        <p className="text-sm font-bold text-green-700">
                          施設側は同意済みです
                        </p>
                        <p className="mt-1 text-sm text-gray-600">
                          演奏者側の同意がそろうと、異議申し立てが解除されます。
                        </p>
                      </div>
                    ) : (
                      <>
                        <p className="mt-3 text-sm text-gray-600">
                          双方が取り下げに同意すると、異議申し立てが解除され、演奏完了の報告を再開できます。
                        </p>

                        <button
                          onClick={handleAgreeDispute}
                          disabled={agreeingDispute}
                          className="w-full mt-4 bg-green-600 text-white rounded-xl p-4 font-bold disabled:opacity-50"
                        >
                          {agreeingDispute
                            ? "同意を登録中..."
                            : "🤝 取り下げに同意する"}
                        </button>
                      </>
                    )}
                  </div>
                </>
            ) : (
              <div className="mt-4 bg-white rounded-xl p-4">
                <p className="text-blue-600 font-bold">
                  📅 演奏完了の確認
                </p>

                <div className="mt-4 space-y-3 text-sm">
                  <div className="rounded-lg border p-3">
                    <p className="font-medium">施設側の報告</p>
                    <p className={facilityReported ? "text-green-700 mt-1" : "text-gray-500 mt-1"}>
                      {facilityReported ? "✅ 報告済み" : "未報告"}
                    </p>
                    {match.facility_completion_reported_at && (
                      <p className="mt-1 text-xs text-gray-500">
                        {formatDateTime(match.facility_completion_reported_at)}
                      </p>
                    )}
                  </div>

                  <div className="rounded-lg border p-3">
                    <p className="font-medium">演奏者側の報告</p>
                    <p className={performerReported ? "text-green-700 mt-1" : "text-gray-500 mt-1"}>
                      {performerReported ? "✅ 報告済み" : "未報告"}
                    </p>
                    {match.performer_completion_reported_at && (
                      <p className="mt-1 text-xs text-gray-500">
                        {formatDateTime(match.performer_completion_reported_at)}
                      </p>
                    )}
                  </div>
                </div>

                <p className="mt-4 text-sm text-gray-600">
                  {facilityReported && performerReported
                    ? "双方の報告を確認しました。演奏状況を再読み込みしてください。"
                    : performerReported
                    ? "演奏者から完了報告が届いています。演奏が完了していることを確認して報告してください。"
                    : facilityReported
                    ? "施設側は報告済みです。演奏者側の確認を待っています。"
                    : "演奏終了後、双方が完了報告を行います。双方の報告がそろうと演奏完了が確定します。"}
                </p>

                {!facilityReported ? (
                  <button
                    onClick={handleComplete}
                    disabled={reportingCompletion}
                    className="w-full mt-5 bg-green-600 text-white rounded-xl p-4 font-bold disabled:opacity-50"
                  >
                    {reportingCompletion
                      ? "報告中..."
                      : "🎵 演奏完了を報告"}
                  </button>
                ) : (
                  <div className="mt-5 bg-green-50 rounded-xl p-3 text-center">
                    <p className="font-bold text-green-700">
                      ✅ 施設側は報告済みです
                    </p>
                    {!performerReported && (
                      <p className="mt-1 text-sm text-gray-600">
                        演奏者側の報告を待っています。
                      </p>
                    )}
                  </div>
                )}

                <button
                  onClick={() =>
                    router.push(`/facility/matches/${matchId}/dispute`)
                  }
                  className="w-full mt-4 bg-white border border-amber-400 text-amber-800 rounded-xl p-3 font-medium"
                >
                  ⚠️ 演奏完了に異議を申し立てる
                </button>

                <p className="mt-2 text-xs text-gray-400 text-center">
                  演奏が完了していない場合や、報告内容に相違がある場合に利用してください。
                </p>

                <button
                  onClick={handleCancel}
                  disabled={cancelling}
                  className="w-full mt-5 bg-white border border-red-300 text-red-600 rounded-xl p-4 font-bold disabled:opacity-50"
                >
                  {cancelling
                    ? "キャンセル中..."
                    : "⚠️ この出演をキャンセルする"}
                </button>
                <p className="mt-2 text-xs text-gray-400 text-center">
                  ※ キャンセルすると、このマッチングでの演奏予定が取り消されます。
                </p>
              </div>
            )}
          </section>

          {notice && (
            <div className="mt-4 bg-green-50 border border-green-200 rounded-xl p-4">
              <p className="text-green-700">{notice}</p>
            </div>
          )}

          {error && (
            <div className="mt-4 bg-red-50 border border-red-200 rounded-xl p-4">
              <p className="text-red-600">{error}</p>
            </div>
          )}

          {performanceRequest && (
            <section className="mt-8">
              <h2 className="text-lg font-bold border-b pb-2">
                🎵 演奏案件
              </h2>
              <div className="mt-4 space-y-3">
                <div>
                  <p className="text-sm text-gray-500">案件タイトル</p>
                  <p className="font-medium">{performanceRequest.title}</p>
                </div>
                {performanceRequest.description && (
                  <div>
                    <p className="text-sm text-gray-500">案件内容</p>
                    <p>{performanceRequest.description}</p>
                  </div>
                )}
                <div>
                  <p className="text-sm text-gray-500">演奏日時</p>
                  <p>
                    {formatDate(performanceRequest.performance_date)}
                    <br />
                    {performanceRequest.start_time} ～ {performanceRequest.end_time}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">場所</p>
                  <p>{performanceRequest.area || "未設定"}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">報酬</p>
                  <p>
                    {performanceRequest.reward !== null
                      ? performanceRequest.reward + "円"
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
                      {performer.name || "名前未設定"}
                    </p>
                    {lineUser?.display_name && (
                      <p className="text-sm text-gray-500">
                        LINE表示名：{lineUser.display_name}
                      </p>
                    )}
                  </div>
                </div>

                <div className="mt-5 space-y-3">
                  <div>
                    <p className="text-sm text-gray-500">活動エリア</p>
                    <p>{performer.area || "未設定"}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">楽器</p>
                    <p>
                      {performer.instruments?.length
                        ? performer.instruments.join("、")
                        : "未設定"}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">ジャンル</p>
                    <p>
                      {performer.genres?.length
                        ? performer.genres.join("、")
                        : "未設定"}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">自己紹介</p>
                    <p className="whitespace-pre-wrap">
                      {performer.bio || "自己紹介はありません"}
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
                <p className="whitespace-pre-wrap">{application.message}</p>
              ) : (
                <p className="text-gray-500">
                  応募メッセージはありません。
                </p>
              )}
            </div>
          </section>

          <section className="mt-8 bg-gray-50 rounded-2xl p-5 border">
            <h2 className="text-lg font-bold">⭐ 演奏者を評価</h2>
            {reviewed ? (
              <div className="mt-4 bg-white rounded-xl p-4">
                <p className="text-gray-700 font-bold">評価済みです</p>
                <p className="mt-1 text-sm text-gray-500">
                  このマッチングはすでに評価しています。
                </p>
              </div>
            ) : isCompleted ? (
              <div>
                <p className="mt-3 text-sm text-gray-600">
                  演奏が完了しました。演奏者への評価をお願いします。
                </p>
                <button
                  onClick={() =>
                    router.push(`/facility/matches/${matchId}/review`)
                  }
                  className="w-full mt-4 bg-yellow-500 text-white rounded-xl p-4 font-bold"
                >
                  ⭐ この演奏者を評価する
                </button>
              </div>
            ) : (
              <div className="mt-4 bg-white rounded-xl p-4">
                <p className="text-gray-700 font-bold">
                  演奏完了後に評価できます
                </p>
                <p className="mt-1 text-sm text-gray-500">
                  演奏者の演奏が完了すると、ここから評価できるようになります。
                </p>
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}