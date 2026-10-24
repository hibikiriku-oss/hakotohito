"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import liff from "@line/liff";

type Facility = {
  id: string;
  user_id: string;
  name: string;
  facility_type: string;
  address: string;
  description: string | null;
};

type FacilityReview = {
  rating: number;
  comment: string | null;
  created_at: string;
};

type PerformanceRequest = {
  id: string;
  title: string;
  description: string | null;
  performance_date: string;
  application_deadline: string;
  start_time: string;
  end_time: string;
  area: string | null;
  instruments: string[];
  genres: string[];
  reward: number | null;
  status: string;
  facilities: Facility | null;
};

type LeaderBand = {
  id: string;
  name: string | null;
  description: string | null;
  status: string;
  role: string;
  createdAt?: string;
  joinedAt?: string;
};

// 日本時間の今日を YYYY-MM-DD 形式で取得
function getJapanToday(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  return `${year}-${month}-${day}`;
}

// YYYY-MM-DD を日本語の日付表示に変換
function formatJapaneseDate(dateString: string): string {
  const match = dateString.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    return dateString;
  }

  return `${Number(match[1])}年${Number(match[2])}月${Number(match[3])}日`;
}

export default function PerformerRequestDetailPage() {
  const params = useParams();
  const router = useRouter();

  const requestId = params.id as string;

  const [request, setRequest] =
    useState<PerformanceRequest | null>(null);

  const [lineUserId, setLineUserId] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");

  const [applicationMode, setApplicationMode] =
    useState<"individual" | "band">("individual");

  const [leaderBands, setLeaderBands] =
    useState<LeaderBand[]>([]);

  const [selectedBandId, setSelectedBandId] =
    useState("");

  const [bandsLoading, setBandsLoading] =
    useState(false);

  const [bandLoadError, setBandLoadError] =
    useState("");

  const [showFacilityProfile, setShowFacilityProfile] =
    useState(false);

  const [facilityRating, setFacilityRating] =
    useState<number | null>(null);

  const [facilityReviewCount, setFacilityReviewCount] =
    useState(0);

  const [facilityReviews, setFacilityReviews] =
    useState<FacilityReview[]>([]);

  const [facilityReviewsLoading, setFacilityReviewsLoading] =
    useState(false);

  const [isFavorite, setIsFavorite] = useState(false);
  const [favoriteLoading, setFavoriteLoading] = useState(false);

  useEffect(() => {
    async function initialize() {
      try {
        const liffId = process.env.NEXT_PUBLIC_LIFF_ID;

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

        const profile = await liff.getProfile();
        setLineUserId(profile.userId);

        // バンド一覧の取得。取得に失敗しても個人応募は継続できる。
        setBandsLoading(true);
        setBandLoadError("");

        try {
          const idToken = liff.getIDToken();

          if (!idToken) {
            throw new Error(
              "LINEの認証情報を取得できません。再ログインしてください。"
            );
          }

          const bandsResponse = await fetch("/api/bands", {
            headers: {
              Authorization: `Bearer ${idToken}`,
            },
            cache: "no-store",
          });

          const bandsData = await bandsResponse.json();

          if (!bandsResponse.ok) {
            throw new Error(
              bandsData.error || "バンド一覧を取得できませんでした"
            );
          }

          const bands: LeaderBand[] = Array.isArray(bandsData.bands)
            ? bandsData.bands
            : [];

          // 現在のアクティブなリーダーバンドだけを応募先に表示
          const eligibleBands = bands.filter(
            (band) =>
              band.role === "leader" &&
              band.status === "active"
          );

          setLeaderBands(eligibleBands);
          setSelectedBandId((current) => {
            if (
              current &&
              eligibleBands.some((band) => band.id === current)
            ) {
              return current;
            }

            return eligibleBands[0]?.id ?? "";
          });
        } catch (bandError) {
          console.error("バンド一覧取得エラー:", bandError);
          setLeaderBands([]);
          setSelectedBandId("");
          setBandLoadError(
            bandError instanceof Error
              ? bandError.message
              : "バンド一覧を取得できませんでした"
          );
        } finally {
          setBandsLoading(false);
        }

        // 案件情報の取得
        const response = await fetch(
          `/api/performance-requests/${requestId}`,
          { cache: "no-store" }
        );

        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            data.error || "案件の取得に失敗しました"
          );
        }

        setRequest(data.request);

        // 施設レビューの取得
        if (data.request.facilities?.id) {
          setFacilityReviewsLoading(true);

          try {
            const facilityResponse = await fetch(
              `/api/facilities/${data.request.facilities.id}`,
              { cache: "no-store" }
            );

            const facilityData = await facilityResponse.json();

            if (facilityResponse.ok) {
              setFacilityRating(facilityData.rating ?? null);
              setFacilityReviewCount(
                facilityData.review_count ?? 0
              );
              setFacilityReviews(facilityData.reviews ?? []);
            }
          } catch (facilityError) {
            console.error(
              "施設レビュー取得エラー:",
              facilityError
            );
          } finally {
            setFacilityReviewsLoading(false);
          }

          // お気に入り状態の取得
          try {
            const favoritesResponse = await fetch(
              "/api/favorites",
              {
                headers: {
                  "x-line-user-id": profile.userId,
                },
                cache: "no-store",
              }
            );

            const favoritesData =
              await favoritesResponse.json();

            if (favoritesResponse.ok) {
              const favoriteExists =
                favoritesData.favorites?.some(
                  (favorite: {
                    target_user_id: string;
                  }) =>
                    favorite.target_user_id ===
                    data.request.facilities.user_id
                );

              setIsFavorite(favoriteExists ?? false);
            }
          } catch (favoriteError) {
            console.error(
              "お気に入り状態取得エラー:",
              favoriteError
            );
          }
        }
      } catch (error) {
        console.error(error);

        setError(
          error instanceof Error
            ? error.message
            : "エラーが発生しました"
        );
      } finally {
        setLoading(false);
      }
    }

    initialize();
  }, [requestId]);

  // 期限日当日は応募可能。翌日から期限切れ。
  const isExpired = request
    ? getJapanToday() >
      String(request.application_deadline || "").slice(0, 10)
    : false;

  const handleFavoriteToggle = async () => {
    if (!lineUserId) {
      alert("LINEユーザー情報を取得できていません");
      return;
    }

    if (!request?.facilities?.id) {
      return;
    }

    try {
      setFavoriteLoading(true);

      if (isFavorite) {
        const response = await fetch("/api/favorites", {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            "x-line-user-id": lineUserId,
          },
          body: JSON.stringify({
            targetUserId: request.facilities.user_id,
          }),
        });

        const data = await response.json();

        if (!response.ok) {
          alert(data.error || "お気に入り解除に失敗しました");
          return;
        }

        setIsFavorite(false);
      } else {
        const response = await fetch("/api/favorites", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-line-user-id": lineUserId,
          },
          body: JSON.stringify({
            targetUserId: request.facilities.user_id,
          }),
        });

        const data = await response.json();

        if (!response.ok) {
          alert(data.error || "お気に入り登録に失敗しました");
          return;
        }

        setIsFavorite(true);
      }
    } catch (error) {
      console.error("お気に入り処理エラー:", error);
      alert("通信エラーが発生しました");
    } finally {
      setFavoriteLoading(false);
    }
  };

  // 個人名義の既存応募処理
  const handleApply = async () => {
    if (!lineUserId) {
      alert("LINEユーザー情報を取得できていません");
      return;
    }

    if (!request) {
      return;
    }

    const today = getJapanToday();
    const deadline = String(
      request.application_deadline || ""
    ).slice(0, 10);

    if (!deadline || today > deadline) {
      alert("応募期限を過ぎているため、この案件には応募できません。");
      return;
    }

    if (request.status !== "open") {
      alert("この案件には現在応募できません");
      return;
    }

    const confirmed = window.confirm(
      "この案件に個人名義で応募しますか？\n応募には10コイン必要です。"
    );

    if (!confirmed) {
      return;
    }

    try {
      setApplying(true);

      const response = await fetch("/api/applications", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-line-user-id": lineUserId,
        },
        body: JSON.stringify({
          requestId,
          message,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        alert(data.error || "応募に失敗しました");
        return;
      }

      alert("個人名義で応募しました！");
      router.push("/performer/home");
    } catch (error) {
      console.error("個人応募エラー:", error);
      alert("通信エラーが発生しました");
    } finally {
      setApplying(false);
    }
  };

  // バンド名義の応募処理
  const handleBandApply = async () => {
    if (!lineUserId) {
      alert("LINEユーザー情報を取得できていません");
      return;
    }

    if (!request) {
      return;
    }

    const today = getJapanToday();
    const deadline = String(
      request.application_deadline || ""
    ).slice(0, 10);

    if (!deadline || today > deadline) {
      alert("応募期限を過ぎているため、この案件には応募できません。");
      return;
    }

    if (request.status !== "open") {
      alert("この案件には現在応募できません");
      return;
    }

    if (bandsLoading) {
      alert("バンド一覧を読み込んでいます。少し待ってからお試しください。");
      return;
    }

    if (bandLoadError) {
      alert(
        `バンド一覧を取得できませんでした。\n${bandLoadError}\n\n画面を開き直してからお試しください。`
      );
      return;
    }

    const selectedBand = leaderBands.find(
      (band) => band.id === selectedBandId
    );

    if (!selectedBand) {
      alert(
        "応募するバンドを選択してください。応募できるのは、あなたがリーダーを務めるアクティブなバンドです。"
      );
      return;
    }

    const confirmed = window.confirm(
      `バンド「${selectedBand.name || "バンド名未設定"}」でこの案件に応募しますか？\n\n応募手数料10コインは、バンドリーダーであるあなた個人のコイン残高から支払われます。`
    );

    if (!confirmed) {
      return;
    }

    try {
      setApplying(true);

      const idToken = liff.getIDToken();

      if (!idToken) {
        alert(
          "LINEの認証情報を取得できません。LINEアプリを開き直して、再度お試しください。"
        );
        return;
      }

      const response = await fetch(
        `/api/bands/${encodeURIComponent(selectedBand.id)}/applications`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${idToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            requestId,
            message,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        alert(data.error || "バンド応募に失敗しました");
        return;
      }

      const spentCoins =
        typeof data.coinsSpent === "number"
          ? data.coinsSpent
          : 10;

      const balanceMessage =
        typeof data.coinBalance === "number"
          ? `\n応募後の個人残高：${data.coinBalance}コイン`
          : "";

      const notificationMessage =
        data.notificationSent === true
          ? "\n施設へのLINE通知を送信しました。"
          : "\n応募は登録されましたが、施設へのLINE通知は送信できなかった可能性があります。";

      alert(
        `バンド「${selectedBand.name || "バンド名未設定"}」で応募しました！\n\n消費コイン：${spentCoins}コイン${balanceMessage}${notificationMessage}`
      );

      router.push("/performer/home");
    } catch (error) {
      console.error("バンド応募エラー:", error);
      alert("通信エラーが発生しました。応募履歴を確認してから再度お試しください。");
    } finally {
      setApplying(false);
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50">
        <div className="max-w-md mx-auto min-h-screen px-4 py-6">
          <header className="pt-2">
            <p className="text-sm font-medium text-gray-500">
              演奏マッチング
            </p>
            <h1 className="mt-1 text-2xl font-bold text-gray-900">
              案件詳細
            </h1>
          </header>

          <div className="mt-8 rounded-2xl bg-white border border-gray-200 p-8 text-center shadow-sm">
            <div className="text-3xl">🎵</div>
            <p className="mt-3 text-sm text-gray-500">
              案件を読み込んでいます...
            </p>
          </div>
        </div>
      </main>
    );
  }

  if (error || !request) {
    return (
      <main className="min-h-screen bg-gray-50">
        <div className="max-w-md mx-auto min-h-screen px-4 py-6">
          <header className="pt-2">
            <p className="text-sm font-medium text-gray-500">
              演奏マッチング
            </p>
            <h1 className="mt-1 text-2xl font-bold text-gray-900">
              案件詳細
            </h1>
          </header>

          <div className="mt-6 rounded-2xl bg-red-50 border border-red-200 p-5">
            <p className="text-sm leading-6 text-red-600">
              {error || "案件が見つかりません"}
            </p>
          </div>

          <button
            onClick={() => router.push("/performer/requests")}
            className="w-full mt-5 rounded-2xl bg-white border border-gray-200 px-5 py-4 text-sm font-semibold text-gray-700 shadow-sm active:bg-gray-50"
          >
            ← 案件一覧へ戻る
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-md mx-auto min-h-screen px-4 py-6">
        {/* 戻る */}
        <button
          onClick={() => router.push("/performer/requests")}
          className="inline-flex items-center text-sm font-medium text-gray-500 active:text-gray-800"
        >
          ← 案件一覧へ戻る
        </button>

        {/* 案件ヘッダー */}
        <section className="mt-4 rounded-2xl bg-white border border-gray-200 p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-gray-400">
                演奏案件
              </p>
              <h1 className="mt-1 text-2xl font-bold leading-8 text-gray-900">
                {request.title}
              </h1>
            </div>

            {request.status === "open" && !isExpired && (
              <span className="shrink-0 rounded-full bg-green-50 border border-green-200 px-3 py-1 text-xs font-semibold text-green-700">
                募集中
              </span>
            )}
          </div>

          {/* 日時・応募期限・場所・報酬 */}
          <div className="mt-5 overflow-hidden rounded-xl border border-gray-100">
            <div className="bg-gray-50 px-4 py-3">
              <p className="text-xs font-medium text-gray-500">
                演奏日時
              </p>
              <p className="mt-1 text-sm font-bold text-gray-900">
                📅 {formatJapaneseDate(request.performance_date)}
              </p>
              <p className="mt-1 text-sm text-gray-700">
                🕐 {request.start_time.slice(0, 5)}
                {" ～ "}
                {request.end_time.slice(0, 5)}
              </p>
            </div>

            <div className="border-t border-gray-100 px-4 py-3">
              <p className="text-xs font-medium text-gray-500">
                応募期限
              </p>
              <p
                className={`mt-1 text-sm font-bold ${
                  isExpired ? "text-red-600" : "text-gray-900"
                }`}
              >
                {isExpired ? "⛔ 応募期限切れ" : "⏳ "}
                {formatJapaneseDate(request.application_deadline)}
              </p>
              <p className="mt-1 text-xs leading-5 text-gray-500">
                {isExpired
                  ? "この案件の応募受付は終了しています。"
                  : "期限日の当日中まで応募できます。"}
              </p>
            </div>

            {request.area && (
              <div className="border-t border-gray-100 px-4 py-3">
                <p className="text-xs font-medium text-gray-500">
                  エリア
                </p>
                <p className="mt-1 text-sm font-semibold text-gray-900">
                  📍 {request.area}
                </p>
              </div>
            )}

            {request.reward !== null && (
              <div className="border-t border-gray-100 px-4 py-3">
                <p className="text-xs font-medium text-gray-500">
                  謝礼
                </p>
                <p className="mt-1 text-lg font-bold text-gray-900">
                  💰 {request.reward.toLocaleString()}円
                </p>
              </div>
            )}
          </div>
        </section>

        {/* 施設情報 */}
        {request.facilities && (
          <section className="mt-4 rounded-2xl bg-white border border-gray-200 p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-gray-400">
                  依頼元
                </p>
                <h2 className="mt-1 text-lg font-bold text-gray-900">
                  🏢 {request.facilities.name}
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  {request.facilities.facility_type}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setShowFacilityProfile(true)}
                className="shrink-0 rounded-xl border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-600 active:bg-gray-50"
              >
                プロフィール
              </button>
            </div>

            <div className="mt-4 rounded-xl bg-gray-50 px-4 py-3">
              <p className="text-xs font-medium text-gray-500">
                所在地
              </p>
              <p className="mt-1 text-sm leading-6 text-gray-700">
                📍 {request.facilities.address}
              </p>
            </div>

            <button
              type="button"
              onClick={() => setShowFacilityProfile(true)}
              className="mt-3 w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-gray-700 active:bg-gray-50"
            >
              施設の詳細・レビューを見る →
            </button>
          </section>
        )}

        {/* 演奏条件 */}
        {(request.instruments?.length > 0 ||
          request.genres?.length > 0) && (
          <section className="mt-4 rounded-2xl bg-white border border-gray-200 p-5 shadow-sm">
            <h2 className="text-base font-bold text-gray-900">
              🎵 演奏条件
            </h2>

            {request.instruments?.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-semibold text-gray-500">
                  演奏してほしい楽器
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {request.instruments.map((instrument) => (
                    <span
                      key={instrument}
                      className="rounded-full bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700"
                    >
                      🎹 {instrument}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {request.genres?.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-semibold text-gray-500">
                  演奏してほしいジャンル
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {request.genres.map((genre) => (
                    <span
                      key={genre}
                      className="rounded-full bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700"
                    >
                      🎼 {genre}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {/* 案件内容 */}
        {request.description && (
          <section className="mt-4 rounded-2xl bg-white border border-gray-200 p-5 shadow-sm">
            <h2 className="text-base font-bold text-gray-900">
              📋 案件内容
            </h2>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-gray-700">
              {request.description}
            </p>
          </section>
        )}

        {/* 応募フォーム */}
        {request.status === "open" && !isExpired ? (
          <section className="mt-5 rounded-2xl bg-white border border-gray-200 p-5 shadow-sm">
            <div>
              <p className="text-xs font-semibold text-gray-400">
                応募
              </p>
              <h2 className="mt-1 text-lg font-bold text-gray-900">
                この案件に応募する
              </h2>
              <p className="mt-2 text-sm leading-6 text-gray-500">
                個人名義またはリーダーを務めるバンド名義で応募できます。
              </p>
            </div>

            {/* 応募方法の切り替え */}
            <div className="mt-4">
              <p className="text-sm font-bold text-gray-700">
                応募方法
              </p>

              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setApplicationMode("individual")}
                  aria-pressed={applicationMode === "individual"}
                  className={`rounded-xl border px-3 py-3 text-sm font-bold transition ${
                    applicationMode === "individual"
                      ? "border-black bg-black text-white"
                      : "border-gray-200 bg-white text-gray-700"
                  }`}
                >
                  👤 個人で応募
                </button>

                <button
                  type="button"
                  onClick={() => setApplicationMode("band")}
                  aria-pressed={applicationMode === "band"}
                  className={`rounded-xl border px-3 py-3 text-sm font-bold transition ${
                    applicationMode === "band"
                      ? "border-purple-700 bg-purple-700 text-white"
                      : "border-gray-200 bg-white text-gray-700"
                  }`}
                >
                  🎸 バンドで応募
                </button>
              </div>
            </div>

            {/* バンド選択 */}
            {applicationMode === "band" && (
              <div className="mt-4 rounded-xl border border-purple-100 bg-purple-50 p-4">
                <label
                  htmlFor="application-band"
                  className="block text-sm font-bold text-purple-900"
                >
                  応募するバンド
                </label>

                {bandsLoading ? (
                  <p className="mt-3 text-sm text-purple-700">
                    バンド一覧を読み込んでいます...
                  </p>
                ) : bandLoadError ? (
                  <div className="mt-3 rounded-lg border border-red-200 bg-white p-3">
                    <p className="text-sm text-red-700">
                      {bandLoadError}
                    </p>
                    <p className="mt-2 text-xs leading-5 text-gray-500">
                      個人応募は引き続き利用できます。バンド応募を使う場合は、LINEアプリで画面を開き直してください。
                    </p>
                  </div>
                ) : leaderBands.length === 0 ? (
                  <div className="mt-3 rounded-lg bg-white p-3">
                    <p className="text-sm font-bold text-gray-800">
                      応募できるバンドがありません
                    </p>
                    <p className="mt-1 text-sm leading-6 text-gray-600">
                      バンド応募には、あなたがリーダーを務めるアクティブなバンドが必要です。バンドを作成するか、既存のバンドでリーダーになってください。
                    </p>
                  </div>
                ) : (
                  <select
                    id="application-band"
                    value={selectedBandId}
                    onChange={(event) =>
                      setSelectedBandId(event.target.value)
                    }
                    className="mt-2 w-full rounded-xl border border-purple-200 bg-white px-3 py-3 text-sm text-gray-900"
                  >
                    <option value="">バンドを選択してください</option>
                    {leaderBands.map((band) => (
                      <option key={band.id} value={band.id}>
                        {band.name || "バンド名未設定"}
                      </option>
                    ))}
                  </select>
                )}

                <div className="mt-3 rounded-lg bg-white p-3">
                  <p className="text-sm font-bold text-purple-900">
                    💰 応募手数料：10コイン
                  </p>
                  <p className="mt-1 text-xs leading-5 text-gray-600">
                    応募手数料はバンド共有残高ではなく、リーダー本人のコイン残高から支払われます。応募ボタンを押すと残高が確認されます。
                  </p>
                </div>
              </div>
            )}

            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder={
                applicationMode === "band"
                  ? "バンドの演奏経験やメンバー構成、今回の演奏への意気込みなど"
                  : "過去の演奏経験や、今回の演奏への意気込みなど"
              }
              rows={5}
              className="mt-4 w-full resize-none rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm leading-6 outline-none transition focus:border-gray-400 focus:bg-white focus:ring-2 focus:ring-gray-100"
            />

            <p className="mt-2 text-right text-xs text-gray-400">
              {message.length}文字
            </p>

            <button
              onClick={
                applicationMode === "band"
                  ? handleBandApply
                  : handleApply
              }
              disabled={
                applying ||
                (applicationMode === "band" &&
                  (bandsLoading ||
                    Boolean(bandLoadError) ||
                    !selectedBandId ||
                    leaderBands.length === 0))
              }
              className={`mt-4 w-full rounded-2xl px-5 py-4 text-base font-bold text-white shadow-sm active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-gray-300 ${
                applicationMode === "band"
                  ? "bg-purple-700"
                  : "bg-black"
              }`}
            >
              {applying
                ? "応募中..."
                : applicationMode === "band"
                  ? "🎸 選択したバンドで応募する"
                  : "この案件に応募する"}
            </button>

            <p className="mt-3 text-center text-xs leading-5 text-gray-400">
              応募には10コイン必要です。施設から承認されるとマッチングが成立します。
            </p>
          </section>
        ) : (
          <section className="mt-5 rounded-2xl bg-gray-100 border border-gray-200 p-5 text-center">
            <div className="text-2xl">
              {isExpired ? "⏰" : "ℹ️"}
            </div>
            <p className="mt-2 text-sm font-medium text-gray-600">
              {isExpired
                ? "応募期限を過ぎているため、この案件には応募できません。"
                : "この案件は現在募集していません。"}
            </p>
          </section>
        )}

        {/* 下部ナビゲーション */}
        <button
          onClick={() => router.push("/performer/requests")}
          className="mt-6 w-full rounded-2xl bg-white border border-gray-200 px-5 py-4 text-sm font-semibold text-gray-600 shadow-sm active:bg-gray-50"
        >
          ← 案件一覧へ戻る
        </button>

        <p className="pb-5 pt-6 text-center text-xs text-gray-400">
          あなたの演奏を、必要としている場所へ。
        </p>
      </div>

      {/* 施設プロフィールモーダル */}
      {showFacilityProfile && request.facilities && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-3 sm:items-center sm:p-6">
          <div className="w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-xl">
            {/* モーダルヘッダー */}
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
              <div>
                <p className="text-xs font-semibold text-gray-400">
                  依頼元
                </p>
                <h2 className="mt-1 text-lg font-bold text-gray-900">
                  施設プロフィール
                </h2>
              </div>

              <button
                type="button"
                onClick={() => setShowFacilityProfile(false)}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 text-xl text-gray-500 active:bg-gray-200"
                aria-label="閉じる"
              >
                ×
              </button>
            </div>

            <div className="max-h-[78vh] overflow-y-auto px-5 py-5">
              {/* 施設基本情報 */}
              <div className="rounded-2xl bg-gray-50 p-4">
                <p className="text-xs font-semibold text-gray-400">
                  施設名
                </p>
                <p className="mt-1 text-xl font-bold text-gray-900">
                  {request.facilities.name}
                </p>
                <p className="mt-2 text-sm text-gray-600">
                  {request.facilities.facility_type}
                </p>
              </div>

              <div className="mt-4 rounded-2xl border border-gray-100 p-4">
                <p className="text-xs font-semibold text-gray-400">
                  住所
                </p>
                <p className="mt-2 text-sm leading-6 text-gray-700">
                  {request.facilities.address}
                </p>
              </div>

              {request.facilities.description && (
                <div className="mt-4 rounded-2xl border border-gray-100 p-4">
                  <p className="text-xs font-semibold text-gray-400">
                    施設紹介
                  </p>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-gray-700">
                    {request.facilities.description}
                  </p>
                </div>
              )}

              {/* レビュー */}
              <div className="mt-5">
                <div className="flex items-end justify-between">
                  <div>
                    <p className="text-xs font-semibold text-gray-400">
                      施設のレビュー
                    </p>
                    <h3 className="mt-1 text-base font-bold text-gray-900">
                      利用した演奏者の評価
                    </h3>
                  </div>

                  {facilityReviewCount > 0 &&
                    facilityRating !== null && (
                      <div className="text-right">
                        <p className="text-lg font-bold text-gray-900">
                          ⭐ {facilityRating.toFixed(1)}
                        </p>
                        <p className="text-xs text-gray-400">
                          {facilityReviewCount}件
                        </p>
                      </div>
                    )}
                </div>

                {facilityReviewsLoading ? (
                  <div className="mt-4 rounded-2xl bg-gray-50 p-5 text-center">
                    <p className="text-sm text-gray-500">
                      レビューを読み込んでいます...
                    </p>
                  </div>
                ) : facilityReviewCount > 0 ? (
                  <div className="mt-4 space-y-3">
                    {facilityReviews.map((review, index) => (
                      <div
                        key={`${review.created_at}-${index}`}
                        className="rounded-2xl bg-gray-50 p-4"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-bold tracking-wide text-gray-800">
                            {"★".repeat(review.rating)}
                            <span className="text-gray-300">
                              {"☆".repeat(5 - review.rating)}
                            </span>
                          </p>
                          <p className="shrink-0 text-xs text-gray-400">
                            {new Date(
                              review.created_at
                            ).toLocaleDateString("ja-JP")}
                          </p>
                        </div>

                        {review.comment && (
                          <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-gray-700">
                            {review.comment}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-4 rounded-2xl bg-gray-50 p-5 text-center">
                    <p className="text-sm text-gray-500">
                      まだレビューはありません。
                    </p>
                  </div>
                )}
              </div>

              {/* お気に入り */}
              <button
                onClick={handleFavoriteToggle}
                disabled={favoriteLoading}
                className={`mt-5 w-full rounded-2xl border px-5 py-4 text-sm font-bold transition ${
                  isFavorite
                    ? "border-pink-200 bg-pink-50 text-pink-600"
                    : "border-gray-200 bg-white text-gray-700"
                } disabled:opacity-50`}
              >
                {favoriteLoading
                  ? "処理中..."
                  : isFavorite
                    ? "♥ お気に入り済み"
                    : "♡ この施設をお気に入りに追加"}
              </button>

              <button
                onClick={() => setShowFacilityProfile(false)}
                className="mt-3 w-full rounded-2xl bg-black px-5 py-4 text-sm font-bold text-white active:bg-gray-800"
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}