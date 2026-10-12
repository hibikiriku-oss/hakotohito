"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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
  created_at: string;
  users: User | User[] | null;
  review_count: number;
  average_rating: number | null;
};

type Favorite = {
  id: string;
  target_user_id: string;
};

export default function FacilityPerformersPage() {
  const router = useRouter();

  const [performers, setPerformers] =
    useState<Performer[]>([]);

  const [favorites, setFavorites] =
    useState<Favorite[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  const [keyword, setKeyword] =
    useState("");

  const [areaFilter, setAreaFilter] =
    useState("");

  const [instrumentFilter, setInstrumentFilter] =
    useState("");

  const [genreFilter, setGenreFilter] =
    useState("");

  const [ratingFilter, setRatingFilter] =
    useState("");

  const [selectedPerformer, setSelectedPerformer] =
    useState<Performer | null>(null);

  const [favoriteLoading, setFavoriteLoading] =
    useState(false);

  useEffect(() => {
    async function fetchData() {
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

        const [
          performersResponse,
          favoritesResponse,
        ] = await Promise.all([
          fetch("/api/performers"),
          fetch("/api/favorites", {
            headers: {
              "x-line-user-id":
                profile.userId,
            },
          }),
        ]);

        const performersData =
          await performersResponse.json();

        if (!performersResponse.ok) {
          throw new Error(
            performersData.error ||
              "演奏者の取得に失敗しました"
          );
        }

        const favoritesData =
          await favoritesResponse.json();

        if (!favoritesResponse.ok) {
          throw new Error(
            favoritesData.error ||
              "お気に入りの取得に失敗しました"
          );
        }

        setPerformers(
          performersData.performers || []
        );

        setFavorites(
          (favoritesData.favorites || []).map(
            (favorite: Favorite) => ({
              id: favorite.id,
              target_user_id:
                favorite.target_user_id,
            })
          )
        );
      } catch (error) {
        console.error(
          "演奏者取得エラー:",
          error
        );

        setError(
          error instanceof Error
            ? error.message
            : "演奏者の取得に失敗しました"
        );
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  const areas = Array.from(
    new Set(
      performers
        .map((performer) => performer.area)
        .filter(Boolean)
    )
  ).sort();

  const instruments = Array.from(
    new Set(
      performers.flatMap(
        (performer) =>
          performer.instruments || []
      )
    )
  ).sort();

  const genres = Array.from(
    new Set(
      performers.flatMap(
        (performer) =>
          performer.genres || []
      )
    )
  ).sort();

  const filteredPerformers =
    performers.filter((performer) => {
      const normalizedKeyword =
        keyword
          .trim()
          .toLowerCase();

      if (normalizedKeyword) {
        const name =
          performer.name || "";

        const bio =
          performer.bio || "";

        const displayName =
          Array.isArray(performer.users)
            ? performer.users[0]?.display_name || ""
            : performer.users?.display_name || "";

        const matchesKeyword =
          name
            .toLowerCase()
            .includes(normalizedKeyword) ||
          bio
            .toLowerCase()
            .includes(normalizedKeyword) ||
          displayName
            .toLowerCase()
            .includes(normalizedKeyword);

        if (!matchesKeyword) {
          return false;
        }
      }

      if (
        areaFilter &&
        performer.area !== areaFilter
      ) {
        return false;
      }

      if (
        instrumentFilter &&
        !(performer.instruments || []).includes(
          instrumentFilter
        )
      ) {
        return false;
      }

      if (
        genreFilter &&
        !(performer.genres || []).includes(
          genreFilter
        )
      ) {
        return false;
      }

      if (ratingFilter) {
        const minimumRating =
          Number(ratingFilter);

        if (
          performer.average_rating === null ||
          performer.average_rating <
            minimumRating
        ) {
          return false;
        }
      }

      return true;
    });

  const clearFilters = () => {
    setKeyword("");
    setAreaFilter("");
    setInstrumentFilter("");
    setGenreFilter("");
    setRatingFilter("");
  };

  const renderStars = (
    rating: number | null
  ) => {
    if (rating === null) {
      return "☆☆☆☆☆";
    }

    const roundedRating =
      Math.round(rating);

    return (
      "★".repeat(
        roundedRating
      ) +
      "☆".repeat(
        5 - roundedRating
      )
    );
  };

  const getUser = (
    performer: Performer
  ) => {
    if (Array.isArray(performer.users)) {
      return performer.users[0] || null;
    }

    return performer.users;
  };

  const isFavorite = (
    performer: Performer
  ) => {
    return favorites.some(
      (favorite) =>
        favorite.target_user_id ===
        performer.user_id
    );
  };

  const handleFavoriteToggle = async (
    performer: Performer
  ) => {
    try {
      setFavoriteLoading(true);

      const liffId =
        process.env.NEXT_PUBLIC_LIFF_ID;

      if (!liffId) {
        throw new Error(
          "NEXT_PUBLIC_LIFF_IDが設定されていません"
        );
      }

      if (!liff.isLoggedIn()) {
        liff.login();
        return;
      }

      const profile =
        await liff.getProfile();

      const currentlyFavorite =
        isFavorite(performer);

      const response = await fetch(
        "/api/favorites",
        {
          method: currentlyFavorite
            ? "DELETE"
            : "POST",
          headers: {
            "Content-Type":
              "application/json",
            "x-line-user-id":
              profile.userId,
          },
          body: JSON.stringify({
            targetUserId:
              performer.user_id,
          }),
        }
      );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
            "お気に入りの変更に失敗しました"
        );
      }

      if (currentlyFavorite) {
        setFavorites(
          (currentFavorites) =>
            currentFavorites.filter(
              (favorite) =>
                favorite.target_user_id !==
                performer.user_id
            )
        );
      } else {
        setFavorites(
          (currentFavorites) => [
            ...currentFavorites,
            {
              id:
                data.favorite?.id ||
                `temporary-${performer.user_id}`,
              target_user_id:
                performer.user_id,
            },
          ]
        );
      }
    } catch (error) {
      console.error(
        "お気に入り変更エラー:",
        error
      );

      alert(
        error instanceof Error
          ? error.message
          : "お気に入りの変更中にエラーが発生しました"
      );
    } finally {
      setFavoriteLoading(false);
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50">
        <div className="max-w-md mx-auto px-4 py-6">

          <header className="pb-6">
            <p className="text-sm font-medium text-gray-500">
              演奏マッチング
            </p>

            <h1 className="text-2xl font-bold text-gray-900 mt-1">
              🎹 演奏者を探す
            </h1>

            <p className="text-sm text-gray-500 mt-2">
              登録されている演奏者から、条件に合う方を探せます。
            </p>
          </header>

          <div className="bg-white border border-gray-200 rounded-2xl p-8 text-center">
            <div className="text-3xl">
              🎹
            </div>

            <p className="text-sm text-gray-500 mt-3">
              演奏者を読み込んでいます…
            </p>
          </div>

        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen bg-gray-50">
        <div className="max-w-md mx-auto px-4 py-6">

          <header className="pb-6">
            <p className="text-sm font-medium text-gray-500">
              演奏マッチング
            </p>

            <h1 className="text-2xl font-bold text-gray-900 mt-1">
              🎹 演奏者を探す
            </h1>
          </header>

          <div className="bg-red-50 border border-red-100 rounded-2xl p-5">
            <div className="text-2xl">
              ⚠️
            </div>

            <p className="text-sm font-bold text-red-700 mt-2">
              演奏者を取得できませんでした
            </p>

            <p className="text-sm text-red-600 mt-1 leading-relaxed">
              {error}
            </p>
          </div>

          <button
            onClick={() =>
              router.push(
                "/facility/home"
              )
            }
            className="w-full mt-5 bg-white border border-gray-200 rounded-2xl p-4 font-bold text-gray-700"
          >
            ← 施設ホームへ戻る
          </button>

        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-md mx-auto px-4 py-6">

        {/* ヘッダー */}
        <header className="pb-5">

          <button
            type="button"
            onClick={() =>
              router.push(
                "/facility/home"
              )
            }
            className="text-sm text-gray-500 mb-4"
          >
            ← 施設ホーム
          </button>

          <p className="text-sm font-medium text-gray-500">
            演奏者検索
          </p>

          <div className="flex items-end justify-between gap-3 mt-1">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                🎹 演奏者を探す
              </h1>

              <p className="text-sm text-gray-500 mt-2">
                条件から演奏者を検索できます。
              </p>
            </div>

            <div className="shrink-0 bg-white border border-gray-200 rounded-full px-3 py-1">
              <span className="text-sm font-bold text-gray-700">
                {filteredPerformers.length}人
              </span>
            </div>
          </div>

        </header>

        {/* 検索条件 */}
        <section className="bg-white border border-gray-200 rounded-2xl p-5">

          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-bold text-gray-900">
                🔎 条件で絞り込む
              </h2>

              <p className="text-xs text-gray-400 mt-1">
                名前・地域・楽器・ジャンル・評価から検索できます。
              </p>
            </div>

            {(keyword ||
              areaFilter ||
              instrumentFilter ||
              genreFilter ||
              ratingFilter) && (
              <button
                type="button"
                onClick={clearFilters}
                className="shrink-0 text-xs font-bold text-gray-500 border border-gray-200 rounded-full px-3 py-1.5"
              >
                クリア
              </button>
            )}
          </div>

          <div className="space-y-4 mt-5">

            {/* キーワード */}
            <div>
              <label className="block text-sm font-bold text-gray-800 mb-2">
                キーワード
              </label>

              <input
                type="text"
                value={keyword}
                onChange={(event) =>
                  setKeyword(
                    event.target.value
                  )
                }
                placeholder="名前・自己紹介から検索"
                className="w-full border border-gray-200 rounded-xl px-4 py-3 bg-gray-50 outline-none focus:bg-white focus:ring-2 focus:ring-black focus:border-transparent"
              />
            </div>

            {/* 地域・楽器 */}
            <div className="grid grid-cols-2 gap-3">

              <div>
                <label className="block text-sm font-bold text-gray-800 mb-2">
                  地域
                </label>

                <select
                  value={areaFilter}
                  onChange={(event) =>
                    setAreaFilter(
                      event.target.value
                    )
                  }
                  className="w-full border border-gray-200 rounded-xl px-3 py-3 bg-gray-50 outline-none focus:bg-white focus:ring-2 focus:ring-black focus:border-transparent"
                >
                  <option value="">
                    すべて
                  </option>

                  {areas.map((area) => (
                    <option
                      key={area}
                      value={area}
                    >
                      {area}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-800 mb-2">
                  楽器
                </label>

                <select
                  value={instrumentFilter}
                  onChange={(event) =>
                    setInstrumentFilter(
                      event.target.value
                    )
                  }
                  className="w-full border border-gray-200 rounded-xl px-3 py-3 bg-gray-50 outline-none focus:bg-white focus:ring-2 focus:ring-black focus:border-transparent"
                >
                  <option value="">
                    すべて
                  </option>

                  {instruments.map(
                    (instrument) => (
                      <option
                        key={instrument}
                        value={instrument}
                      >
                        {instrument}
                      </option>
                    )
                  )}
                </select>
              </div>

            </div>

            {/* ジャンル・評価 */}
            <div className="grid grid-cols-2 gap-3">

              <div>
                <label className="block text-sm font-bold text-gray-800 mb-2">
                  ジャンル
                </label>

                <select
                  value={genreFilter}
                  onChange={(event) =>
                    setGenreFilter(
                      event.target.value
                    )
                  }
                  className="w-full border border-gray-200 rounded-xl px-3 py-3 bg-gray-50 outline-none focus:bg-white focus:ring-2 focus:ring-black focus:border-transparent"
                >
                  <option value="">
                    すべて
                  </option>

                  {genres.map((genre) => (
                    <option
                      key={genre}
                      value={genre}
                    >
                      {genre}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-800 mb-2">
                  最低評価
                </label>

                <select
                  value={ratingFilter}
                  onChange={(event) =>
                    setRatingFilter(
                      event.target.value
                    )
                  }
                  className="w-full border border-gray-200 rounded-xl px-3 py-3 bg-gray-50 outline-none focus:bg-white focus:ring-2 focus:ring-black focus:border-transparent"
                >
                  <option value="">
                    すべて
                  </option>

                  <option value="4">
                    ★ 4.0以上
                  </option>

                  <option value="3">
                    ★ 3.0以上
                  </option>

                  <option value="2">
                    ★ 2.0以上
                  </option>

                  <option value="1">
                    ★ 1.0以上
                  </option>
                </select>
              </div>

            </div>

          </div>

        </section>

        {/* 件数 */}
        <div className="flex items-center justify-between mt-5 mb-3">
          <p className="text-sm font-bold text-gray-700">
            検索結果
          </p>

          <p className="text-xs text-gray-400">
            {filteredPerformers.length}人
          </p>
        </div>

        {/* 検索結果 */}
        {filteredPerformers.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-2xl p-7 text-center">

            <div className="text-4xl">
              🔍
            </div>

            <h2 className="font-bold text-gray-900 mt-4">
              条件に一致する演奏者がいません
            </h2>

            <p className="text-sm text-gray-500 mt-2 leading-relaxed">
              検索条件を変更すると、他の演奏者が見つかるかもしれません。
            </p>

            <button
              type="button"
              onClick={clearFilters}
              className="mt-5 bg-black text-white rounded-xl px-5 py-3 font-bold"
            >
              条件をクリア
            </button>

          </div>
        ) : (
          <div className="space-y-3">

            {filteredPerformers.map(
              (performer) => {
                const user =
                  getUser(performer);

                const favorite =
                  isFavorite(
                    performer
                  );

                return (
                  <button
                    key={performer.id}
                    type="button"
                    onClick={() =>
                      setSelectedPerformer(
                        performer
                      )
                    }
                    className="w-full text-left bg-white border border-gray-200 rounded-2xl p-5 shadow-sm active:scale-[0.99] transition"
                  >

                    <div className="flex items-start gap-4">

                      {user?.picture_url ? (
                        <img
                          src={
                            user.picture_url
                          }
                          alt=""
                          className="w-14 h-14 rounded-2xl object-cover shrink-0"
                        />
                      ) : (
                        <div className="w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center text-2xl shrink-0">
                          🎹
                        </div>
                      )}

                      <div className="flex-1 min-w-0">

                        <div className="flex items-start justify-between gap-2">

                          <h2 className="text-base font-bold text-gray-900 leading-snug">
                            {performer.name}
                          </h2>

                          <span
                            className={`shrink-0 text-lg ${
                              favorite
                                ? "text-yellow-500"
                                : "text-gray-300"
                            }`}
                          >
                            {favorite
                              ? "♥"
                              : "♡"}
                          </span>

                        </div>

                        <p className="text-sm text-gray-500 mt-1">
                          📍 {performer.area}
                        </p>

                        <div className="flex items-center gap-2 mt-2">

                          <span className="text-sm font-bold text-gray-800">
                            ⭐{" "}
                            {performer.average_rating !==
                            null
                              ? performer.average_rating.toFixed(
                                  1
                                )
                              : "未評価"}
                          </span>

                          <span className="text-xs text-gray-400">
                            {performer.review_count}件のレビュー
                          </span>

                        </div>

                      </div>

                    </div>

                    {(performer.instruments?.length >
                      0 ||
                      performer.genres?.length >
                        0) && (
                      <div className="mt-4 flex flex-wrap gap-1.5">

                        {performer.instruments.map(
                          (instrument) => (
                            <span
                              key={`instrument-${instrument}`}
                              className="text-xs bg-gray-100 text-gray-600 rounded-full px-2.5 py-1"
                            >
                              🎹 {instrument}
                            </span>
                          )
                        )}

                        {performer.genres.map(
                          (genre) => (
                            <span
                              key={`genre-${genre}`}
                              className="text-xs bg-blue-50 text-blue-700 rounded-full px-2.5 py-1"
                            >
                              🎵 {genre}
                            </span>
                          )
                        )}

                      </div>
                    )}

                    {performer.bio && (
                      <p className="mt-3 text-sm text-gray-500 leading-relaxed line-clamp-2">
                        {performer.bio}
                      </p>
                    )}

                    <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between">

                      <span className="text-xs text-gray-400">
                        タップしてプロフィールを確認
                      </span>

                      <span className="text-sm font-bold text-gray-700">
                        詳細を見る →
                      </span>

                    </div>

                  </button>
                );
              }
            )}

          </div>
        )}

        {/* 戻る */}
        <button
          type="button"
          onClick={() =>
            router.push(
              "/facility/home"
            )
          }
          className="w-full mt-6 bg-white border border-gray-200 rounded-2xl p-4 font-bold text-gray-600"
        >
          ← 施設ホームへ戻る
        </button>

        <p className="text-center text-xs text-gray-400 mt-6 pb-4">
          演奏者と施設をつなぐ、演奏マッチング
        </p>

        {/* プロフィールモーダル */}
        {selectedPerformer && (
          <div
            className="fixed inset-0 bg-black/40 z-50 flex items-end justify-center"
            onClick={() =>
              setSelectedPerformer(null)
            }
          >
            <div
              className="bg-white w-full max-w-md rounded-t-3xl max-h-[90vh] overflow-y-auto"
              onClick={(event) =>
                event.stopPropagation()
              }
            >

              {/* モーダルヘッダー */}
              <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-4 flex items-center justify-between z-10">

                <div>
                  <p className="text-xs text-gray-400">
                    演奏者プロフィール
                  </p>

                  <h2 className="text-lg font-bold text-gray-900 mt-0.5">
                    🎹{" "}
                    {selectedPerformer.name}
                  </h2>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    setSelectedPerformer(null)
                  }
                  className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center text-gray-500"
                >
                  ✕
                </button>

              </div>

              <div className="p-5">

                {/* プロフィール */}
                <div className="flex items-center gap-4">

                  {getUser(
                    selectedPerformer
                  )?.picture_url ? (
                    <img
                      src={
                        getUser(
                          selectedPerformer
                        )?.picture_url || ""
                      }
                      alt=""
                      className="w-16 h-16 rounded-2xl object-cover"
                    />
                  ) : (
                    <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center text-3xl">
                      🎹
                    </div>
                  )}

                  <div className="min-w-0">

                    <h3 className="text-xl font-bold text-gray-900">
                      {selectedPerformer.name}
                    </h3>

                    <p className="text-sm text-gray-500 mt-1">
                      📍{" "}
                      {selectedPerformer.area}
                    </p>

                  </div>

                </div>

                {/* 評価 */}
                <div className="mt-5 bg-gray-50 rounded-2xl p-4">

                  <div className="flex items-center justify-between">

                    <div>
                      <p className="text-sm font-bold text-gray-800">
                        ⭐ 評価
                      </p>

                      <p className="text-xs text-gray-400 mt-1">
                        {selectedPerformer.review_count}
                        件のレビュー
                      </p>
                    </div>

                    <div className="text-right">

                      <p className="text-xl font-bold text-gray-900">
                        {selectedPerformer.average_rating !==
                        null
                          ? selectedPerformer.average_rating.toFixed(
                              1
                            )
                          : "—"}
                      </p>

                      <p className="text-sm text-yellow-500 tracking-tight">
                        {renderStars(
                          selectedPerformer.average_rating
                        )}
                      </p>

                    </div>

                  </div>

                </div>

                {/* 楽器 */}
                <div className="mt-5">

                  <h3 className="text-sm font-bold text-gray-900">
                    🎹 楽器
                  </h3>

                  <div className="mt-2 flex flex-wrap gap-1.5">

                    {selectedPerformer.instruments.map(
                      (instrument) => (
                        <span
                          key={instrument}
                          className="text-sm bg-gray-100 text-gray-700 rounded-full px-3 py-1.5"
                        >
                          {instrument}
                        </span>
                      )
                    )}

                  </div>

                </div>

                {/* ジャンル */}
                <div className="mt-5">

                  <h3 className="text-sm font-bold text-gray-900">
                    🎵 ジャンル
                  </h3>

                  <div className="mt-2 flex flex-wrap gap-1.5">

                    {selectedPerformer.genres.map(
                      (genre) => (
                        <span
                          key={genre}
                          className="text-sm bg-blue-50 text-blue-700 rounded-full px-3 py-1.5"
                        >
                          {genre}
                        </span>
                      )
                    )}

                  </div>

                </div>

                {/* 自己紹介 */}
                {selectedPerformer.bio && (
                  <div className="mt-5">

                    <h3 className="text-sm font-bold text-gray-900">
                      📝 自己紹介
                    </h3>

                    <div className="mt-2 bg-gray-50 rounded-2xl p-4">
                      <p className="text-sm text-gray-600 whitespace-pre-wrap leading-relaxed">
                        {selectedPerformer.bio}
                      </p>
                    </div>

                  </div>
                )}

                {/* アクション */}
                <div className="mt-6">

                  <button
                    type="button"
                    onClick={() =>
                      handleFavoriteToggle(
                        selectedPerformer
                      )
                    }
                    disabled={
                      favoriteLoading
                    }
                    className={`w-full rounded-2xl p-4 font-bold border ${
                      isFavorite(
                        selectedPerformer
                      )
                        ? "bg-yellow-50 border-yellow-200 text-yellow-700"
                        : "bg-white border-gray-200 text-gray-700"
                    } disabled:opacity-50`}
                  >
                    {favoriteLoading
                      ? "変更しています..."
                      : isFavorite(
                          selectedPerformer
                        )
                      ? "♥ お気に入り済み"
                      : "♡ お気に入りに追加"}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      router.push(
                        `/facility/performers/${selectedPerformer.id}/invite`
                      );
                    }}
                    className="w-full mt-3 bg-black text-white rounded-2xl p-4 font-bold active:scale-[0.99] transition"
                  >
                    🎵 この演奏者に依頼する
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setSelectedPerformer(null)
                    }
                    className="w-full mt-3 bg-gray-100 text-gray-700 rounded-2xl p-4 font-bold"
                  >
                    閉じる
                  </button>

                </div>

              </div>

              <div className="h-4" />

            </div>
          </div>
        )}

      </div>
    </main>
  );
}