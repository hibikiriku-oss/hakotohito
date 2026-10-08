"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

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

export default function FacilityPerformersPage() {
  const router = useRouter();

  const [performers, setPerformers] =
    useState<Performer[]>([]);

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

  useEffect(() => {
    async function fetchPerformers() {
      try {
        const response = await fetch(
          "/api/performers"
        );

        const data =
          await response.json();

        if (!response.ok) {
          throw new Error(
            data.error ||
              "演奏者の取得に失敗しました"
          );
        }

        setPerformers(
          data.performers || []
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

    fetchPerformers();
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

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-md mx-auto">
          <h1 className="text-2xl font-bold">
            🎹 演奏者を探す
          </h1>

          <p className="mt-8 text-center text-gray-500">
            演奏者を読み込んでいます…
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
            🎹 演奏者を探す
          </h1>

          <div className="mt-6 p-4 bg-red-50 rounded-xl">
            <p className="text-red-600">
              {error}
            </p>
          </div>

          <button
            onClick={() =>
              router.push(
                "/facility/home"
              )
            }
            className="w-full mt-6 bg-white border rounded-xl p-4"
          >
            ← 施設ホームへ戻る
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-md mx-auto">

        <div className="mb-6">
          <h1 className="text-2xl font-bold">
            🎹 演奏者を探す
          </h1>

          <p className="text-sm text-gray-500 mt-1">
            登録されている演奏者から探せます
          </p>
        </div>

        <div className="bg-white rounded-2xl p-5 shadow-sm border mb-6">
          <h2 className="text-lg font-bold mb-4">
            🔎 演奏者を絞り込む
          </h2>

          <div className="space-y-4">

            <div>
              <label className="block text-sm font-medium mb-2">
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
                className="w-full border rounded-xl p-3"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">
                地域
              </label>

              <select
                value={areaFilter}
                onChange={(event) =>
                  setAreaFilter(
                    event.target.value
                  )
                }
                className="w-full border rounded-xl p-3 bg-white"
              >
                <option value="">
                  すべての地域
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
              <label className="block text-sm font-medium mb-2">
                楽器
              </label>

              <select
                value={instrumentFilter}
                onChange={(event) =>
                  setInstrumentFilter(
                    event.target.value
                  )
                }
                className="w-full border rounded-xl p-3 bg-white"
              >
                <option value="">
                  すべての楽器
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

            <div>
              <label className="block text-sm font-medium mb-2">
                ジャンル
              </label>

              <select
                value={genreFilter}
                onChange={(event) =>
                  setGenreFilter(
                    event.target.value
                  )
                }
                className="w-full border rounded-xl p-3 bg-white"
              >
                <option value="">
                  すべてのジャンル
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
              <label className="block text-sm font-medium mb-2">
                最低評価
              </label>

              <select
                value={ratingFilter}
                onChange={(event) =>
                  setRatingFilter(
                    event.target.value
                  )
                }
                className="w-full border rounded-xl p-3 bg-white"
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

            <button
              type="button"
              onClick={clearFilters}
              className="w-full border rounded-xl p-3 text-gray-700"
            >
              条件をクリア
            </button>
          </div>
        </div>

        <div className="mb-4">
          <p className="text-sm text-gray-600">
            {filteredPerformers.length}
            人の演奏者が見つかりました
          </p>
        </div>

        {filteredPerformers.length === 0 ? (
          <div className="bg-white rounded-2xl p-6 text-center">
            <p className="text-gray-500">
              条件に一致する演奏者がいません。
            </p>

            <button
              type="button"
              onClick={clearFilters}
              className="mt-4 text-sm text-blue-600"
            >
              条件をクリアしてすべて表示
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredPerformers.map(
              (performer) => {
                const user =
                  getUser(performer);

                return (
                  <button
                    key={performer.id}
                    type="button"
                    onClick={() =>
                      setSelectedPerformer(
                        performer
                      )
                    }
                    className="w-full text-left bg-white rounded-2xl p-5 shadow-sm border"
                  >
                    <div className="flex items-start gap-4">

                      {user?.picture_url ? (
                        <img
                          src={
                            user.picture_url
                          }
                          alt=""
                          className="w-14 h-14 rounded-full object-cover"
                        />
                      ) : (
                        <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center text-2xl">
                          🎹
                        </div>
                      )}

                      <div className="flex-1 min-w-0">

                        <h2 className="text-lg font-bold">
                          {performer.name}
                        </h2>

                        <p className="mt-1 text-sm text-gray-500">
                          📍 {performer.area}
                        </p>

                        <div className="mt-2">
                          <span className="text-sm">
                            ⭐{" "}
                            {performer.average_rating !==
                            null
                              ? performer.average_rating.toFixed(
                                  1
                                )
                              : "未評価"}
                          </span>

                          <span className="text-xs text-gray-500 ml-2">
                            (
                            {
                              performer.review_count
                            }
                            件)
                          </span>
                        </div>

                      </div>
                    </div>

                    {performer.instruments?.length >
                      0 && (
                      <div className="mt-4 flex flex-wrap gap-2">
                        {performer.instruments.map(
                          (instrument) => (
                            <span
                              key={instrument}
                              className="text-xs bg-gray-100 rounded-full px-3 py-1"
                            >
                              🎹 {instrument}
                            </span>
                          )
                        )}
                      </div>
                    )}

                    {performer.genres?.length >
                      0 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {performer.genres.map(
                          (genre) => (
                            <span
                              key={genre}
                              className="text-xs bg-blue-50 rounded-full px-3 py-1"
                            >
                              🎵 {genre}
                            </span>
                          )
                        )}
                      </div>
                    )}

                    {performer.bio && (
                      <p className="mt-3 text-sm text-gray-600 line-clamp-2">
                        {performer.bio}
                      </p>
                    )}

                    <p className="mt-4 text-right text-sm text-gray-400">
                      プロフィールを見る →
                    </p>
                  </button>
                );
              }
            )}
          </div>
        )}

        <button
          type="button"
          onClick={() =>
            router.push(
              "/facility/home"
            )
          }
          className="w-full mt-6 bg-white border rounded-xl p-4"
        >
          ← 施設ホームへ戻る
        </button>

        {selectedPerformer && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-6 z-50">
            <div className="bg-white rounded-2xl w-full max-w-md max-h-[85vh] overflow-y-auto p-6">

              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold">
                    🎹{" "}
                    {selectedPerformer.name}
                  </h2>

                  <p className="mt-1 text-sm text-gray-500">
                    📍{" "}
                    {selectedPerformer.area}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    setSelectedPerformer(null)
                  }
                  className="text-gray-500 text-xl"
                >
                  ✕
                </button>
              </div>

              <div className="mt-5 p-4 bg-gray-50 rounded-xl">
                <p className="font-bold">
                  ⭐ 評価
                </p>

                <p className="mt-2 text-lg">
                  {renderStars(
                    selectedPerformer.average_rating
                  )}
                </p>

                <p className="text-sm text-gray-600 mt-1">
                  {selectedPerformer.average_rating !==
                  null
                    ? selectedPerformer.average_rating.toFixed(
                        1
                      )
                    : "未評価"}
                  {" / "}
                  {
                    selectedPerformer.review_count
                  }
                  件
                </p>
              </div>

              <div className="mt-5">
                <h3 className="font-bold">
                  🎹 楽器
                </h3>

                <div className="mt-2 flex flex-wrap gap-2">
                  {selectedPerformer.instruments.map(
                    (instrument) => (
                      <span
                        key={instrument}
                        className="text-sm bg-gray-100 rounded-full px-3 py-1"
                      >
                        {instrument}
                      </span>
                    )
                  )}
                </div>
              </div>

              <div className="mt-5">
                <h3 className="font-bold">
                  🎵 ジャンル
                </h3>

                <div className="mt-2 flex flex-wrap gap-2">
                  {selectedPerformer.genres.map(
                    (genre) => (
                      <span
                        key={genre}
                        className="text-sm bg-blue-50 rounded-full px-3 py-1"
                      >
                        {genre}
                      </span>
                    )
                  )}
                </div>
              </div>

              {selectedPerformer.bio && (
                <div className="mt-5">
                  <h3 className="font-bold">
                    📝 自己紹介
                  </h3>

                  <p className="mt-2 text-sm text-gray-600 whitespace-pre-wrap">
                    {selectedPerformer.bio}
                  </p>
                </div>
              )}

              <button
                type="button"
                onClick={() => {
                  router.push(
                    `/facility/performers/${selectedPerformer.id}/invite`
                  );
                }}
                className="w-full mt-6 bg-blue-600 text-white rounded-xl p-4 font-bold"
              >
                この演奏者に依頼する
              </button>

              <button
                type="button"
                onClick={() =>
                  setSelectedPerformer(null)
                }
                className="w-full mt-3 bg-gray-100 text-gray-700 rounded-xl p-4"
              >
                閉じる
              </button>

            </div>
          </div>
        )}

      </div>
    </main>
  );
}