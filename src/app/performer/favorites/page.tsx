"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import liff from "@line/liff";

type Facility = {
  id: string;
  name: string | null;
  facility_type: string | null;
  address: string | null;
  description: string | null;
};

type FavoriteUser = {
  id: string;
  display_name: string | null;
  picture_url: string | null;
  user_type: string | null;
  facilities:
    | Facility
    | Facility[]
    | null;
};

type Favorite = {
  id: string;
  target_user_id: string;
  created_at: string;
  users:
    | FavoriteUser
    | FavoriteUser[]
    | null;
};

export default function PerformerFavoritesPage() {
  const router = useRouter();

  const [favorites, setFavorites] =
    useState<Favorite[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  const [selectedFacility, setSelectedFacility] =
    useState<{
      user: FavoriteUser;
      facility: Facility;
    } | null>(null);

  const [removingFavoriteId, setRemovingFavoriteId] =
    useState<string | null>(null);

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

        const response = await fetch(
          "/api/favorites",
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
              "お気に入りの取得に失敗しました"
          );
        }

        setFavorites(
          data.favorites ?? []
        );
      } catch (error) {
        console.error(
          "お気に入り一覧取得エラー:",
          error
        );

        setError(
          error instanceof Error
            ? error.message
            : "お気に入りの取得中にエラーが発生しました"
        );
      } finally {
        setLoading(false);
      }
    }

    initialize();
  }, []);

  const getFavoriteUser = (
    favorite: Favorite
  ): FavoriteUser | null => {
    if (Array.isArray(favorite.users)) {
      return favorite.users[0] ?? null;
    }

    return favorite.users;
  };

  const getFavoriteFacility = (
    user: FavoriteUser | null
  ): Facility | null => {
    if (!user?.facilities) {
      return null;
    }

    if (Array.isArray(user.facilities)) {
      return user.facilities[0] ?? null;
    }

    return user.facilities;
  };

  const handleFacilityProfile = (
    favorite: Favorite
  ) => {
    const user =
      getFavoriteUser(favorite);

    const facility =
      getFavoriteFacility(user);

    if (!user || !facility) {
      alert(
        "施設プロフィール情報を取得できませんでした。"
      );
      return;
    }

    setSelectedFacility({
      user,
      facility,
    });
  };

  const handleRemoveFavorite = async (
    favorite: Favorite
  ) => {
    const user =
      getFavoriteUser(favorite);

    if (!user) {
      alert(
        "お気に入り情報を取得できませんでした。"
      );
      return;
    }

    const facility =
      getFavoriteFacility(user);

    const facilityName =
      facility?.name ||
      user.display_name ||
      "この施設";

    const confirmed =
      window.confirm(
        `${facilityName}をお気に入りから解除しますか？`
      );

    if (!confirmed) {
      return;
    }

    try {
      setRemovingFavoriteId(
        favorite.id
      );

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

      const response = await fetch(
        "/api/favorites",
        {
          method: "DELETE",
          headers: {
            "Content-Type":
              "application/json",
            "x-line-user-id":
              profile.userId,
          },
          body: JSON.stringify({
            targetUserId:
              favorite.target_user_id,
          }),
        }
      );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
            "お気に入りの解除に失敗しました"
        );
      }

      setFavorites((currentFavorites) =>
        currentFavorites.filter(
          (item) =>
            item.id !== favorite.id
        )
      );

      setSelectedFacility(null);
    } catch (error) {
      console.error(
        "お気に入り解除エラー:",
        error
      );

      alert(
        error instanceof Error
          ? error.message
          : "お気に入りの解除中にエラーが発生しました"
      );
    } finally {
      setRemovingFavoriteId(null);
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50">
        <div className="max-w-md mx-auto min-h-screen px-5 py-6">
          <header>
            <button
              onClick={() =>
                router.push(
                  "/performer/home"
                )
              }
              className="text-sm text-gray-500"
            >
              ← ホームへ戻る
            </button>

            <div className="mt-6">
              <p className="text-sm font-bold text-gray-500">
                🎸 演奏者ホーム
              </p>

              <h1 className="text-2xl font-bold mt-1">
                ⭐ お気に入り
              </h1>

              <p className="text-sm text-gray-500 mt-2">
                気になる施設をすぐ確認できます。
              </p>
            </div>
          </header>

          <div className="mt-10 bg-white rounded-2xl p-8 text-center shadow-sm">
            <div className="text-4xl">
              ⭐
            </div>

            <p className="mt-4 text-gray-600">
              お気に入りを読み込んでいます...
            </p>
          </div>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen bg-gray-50">
        <div className="max-w-md mx-auto min-h-screen px-5 py-6">
          <button
            onClick={() =>
              router.push(
                "/performer/home"
              )
            }
            className="text-sm text-gray-500"
          >
            ← ホームへ戻る
          </button>

          <div className="mt-6">
            <p className="text-sm font-bold text-gray-500">
              🎸 演奏者ホーム
            </p>

            <h1 className="text-2xl font-bold mt-1">
              ⭐ お気に入り
            </h1>
          </div>

          <div className="mt-8 bg-red-50 border border-red-200 rounded-2xl p-5">
            <div className="flex items-start gap-3">
              <div className="text-xl">
                ⚠️
              </div>

              <div>
                <p className="font-bold text-red-700">
                  お気に入りを取得できませんでした
                </p>

                <p className="text-sm text-red-600 mt-1">
                  {error}
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-md mx-auto min-h-screen px-5 py-6 pb-10">

        {/* ヘッダー */}
        <header>
          <button
            onClick={() =>
              router.push(
                "/performer/home"
              )
            }
            className="text-sm text-gray-500"
          >
            ← ホームへ戻る
          </button>

          <div className="mt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-gray-500">
                  🎸 演奏者ホーム
                </p>

                <h1 className="text-2xl font-bold mt-1">
                  ⭐ お気に入り
                </h1>
              </div>

              <div className="bg-yellow-50 border border-yellow-100 rounded-2xl px-4 py-3 text-center">
                <p className="text-xl font-bold text-yellow-700">
                  {favorites.length}
                </p>

                <p className="text-[11px] text-yellow-600">
                  件
                </p>
              </div>
            </div>

            <p className="text-sm text-gray-500 mt-3">
              気になる施設をお気に入りに登録しておくと、あとから簡単に確認できます。
            </p>
          </div>
        </header>

        {/* 空状態 */}
        {favorites.length === 0 ? (
          <div className="mt-8 bg-white rounded-3xl p-8 text-center shadow-sm border border-gray-100">
            <div className="w-20 h-20 mx-auto rounded-full bg-yellow-50 flex items-center justify-center text-4xl">
              ⭐
            </div>

            <h2 className="text-lg font-bold mt-5">
              まだお気に入りはありません
            </h2>

            <p className="text-sm text-gray-500 mt-2 leading-6">
              気になる施設を見つけたら、
              <br />
              お気に入りに登録しておきましょう。
            </p>

            <button
              onClick={() =>
                router.push(
                  "/performer/requests"
                )
              }
              className="w-full mt-6 bg-black text-white rounded-2xl p-4 font-bold"
            >
              🔍 演奏案件を探す
            </button>
          </div>
        ) : (
          <div className="mt-7 space-y-4">
            {favorites.map((favorite) => {
              const user =
                getFavoriteUser(favorite);

              const facility =
                getFavoriteFacility(user);

              const isRemoving =
                removingFavoriteId ===
                favorite.id;

              const facilityName =
                facility?.name ||
                user?.display_name ||
                "施設";

              return (
                <div
                  key={favorite.id}
                  className="bg-white rounded-3xl p-5 shadow-sm border border-gray-100"
                >
                  {/* 施設情報 */}
                  <div className="flex items-start gap-4">
                    {user?.picture_url ? (
                      <img
                        src={user.picture_url}
                        alt=""
                        className="w-16 h-16 rounded-2xl object-cover shrink-0"
                      />
                    ) : (
                      <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center text-3xl shrink-0">
                        🏢
                      </div>
                    )}

                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h2 className="font-bold text-lg truncate">
                            {facilityName}
                          </h2>

                          <p className="text-sm text-gray-500 mt-1">
                            {facility?.facility_type ||
                              "施設"}
                          </p>
                        </div>

                        <span className="shrink-0 bg-yellow-50 text-yellow-700 text-xs font-bold px-2.5 py-1 rounded-full">
                          ⭐ お気に入り
                        </span>
                      </div>

                      {facility?.address && (
                        <p className="text-sm text-gray-500 mt-3 line-clamp-2">
                          📍 {facility.address}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* アクション */}
                  <div className="mt-5 pt-4 border-t border-gray-100">
                    <button
                      onClick={() =>
                        handleFacilityProfile(
                          favorite
                        )
                      }
                      className="w-full bg-black text-white rounded-2xl p-3.5 font-bold"
                    >
                      施設プロフィールを見る
                    </button>

                    <button
                      onClick={() =>
                        handleRemoveFavorite(
                          favorite
                        )
                      }
                      disabled={isRemoving}
                      className="w-full mt-2.5 text-gray-500 rounded-2xl p-3 text-sm font-medium disabled:opacity-50"
                    >
                      {isRemoving
                        ? "解除しています..."
                        : "お気に入りから解除"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* プロフィールモーダル */}
        {selectedFacility && (
          <div
            className="fixed inset-0 z-50 bg-black/50 flex items-end justify-center"
            onClick={() =>
              setSelectedFacility(null)
            }
          >
            <div
              className="w-full max-w-md bg-white rounded-t-3xl max-h-[88vh] overflow-y-auto"
              onClick={(event) =>
                event.stopPropagation()
              }
            >
              {/* モーダルヘッダー */}
              <div className="sticky top-0 bg-white border-b px-5 py-4 flex items-center justify-between z-10">
                <div>
                  <p className="text-xs font-bold text-gray-400">
                    FACILITY PROFILE
                  </p>

                  <h2 className="text-lg font-bold mt-0.5">
                    施設プロフィール
                  </h2>
                </div>

                <button
                  onClick={() =>
                    setSelectedFacility(null)
                  }
                  className="w-9 h-9 rounded-full bg-gray-100 text-gray-500 text-xl"
                  aria-label="閉じる"
                >
                  ×
                </button>
              </div>

              <div className="p-5">
                {/* プロフィール */}
                <div className="flex items-center gap-4">
                  {selectedFacility.user
                    .picture_url ? (
                    <img
                      src={
                        selectedFacility.user
                          .picture_url
                      }
                      alt=""
                      className="w-20 h-20 rounded-2xl object-cover"
                    />
                  ) : (
                    <div className="w-20 h-20 rounded-2xl bg-gray-100 flex items-center justify-center text-4xl">
                      🏢
                    </div>
                  )}

                  <div className="min-w-0">
                    <h3 className="text-xl font-bold">
                      {selectedFacility.facility
                        .name ||
                        selectedFacility.user
                          .display_name ||
                        "施設"}
                    </h3>

                    <p className="text-sm text-gray-500 mt-1">
                      {selectedFacility.facility
                        .facility_type ||
                        "施設"}
                    </p>
                  </div>
                </div>

                <div className="mt-7 space-y-6">

                  {/* 住所 */}
                  <section>
                    <p className="text-xs font-bold text-gray-400">
                      LOCATION
                    </p>

                    <h4 className="font-bold mt-1">
                      📍 住所
                    </h4>

                    <p className="text-gray-700 mt-2 leading-6">
                      {selectedFacility.facility
                        .address ||
                        "住所は登録されていません"}
                    </p>
                  </section>

                  {/* 施設説明 */}
                  <section>
                    <p className="text-xs font-bold text-gray-400">
                      ABOUT
                    </p>

                    <h4 className="font-bold mt-1">
                      📝 施設について
                    </h4>

                    <p className="text-gray-700 mt-2 leading-6 whitespace-pre-wrap">
                      {selectedFacility.facility
                        .description ||
                        "施設の説明は登録されていません"}
                    </p>
                  </section>

                  {/* お気に入り状態 */}
                  <section className="bg-yellow-50 border border-yellow-100 rounded-2xl p-4">
                    <p className="text-sm font-bold text-yellow-700">
                      ⭐ お気に入り登録中
                    </p>

                    <p className="text-sm text-yellow-700/80 mt-1">
                      この施設をお気に入りに登録しています。
                    </p>
                  </section>

                  <button
                    onClick={() =>
                      handleRemoveFavorite(
                        favorites.find(
                          (favorite) =>
                            favorite.target_user_id ===
                            selectedFacility.user.id
                        ) ?? {
                          id: "",
                          target_user_id:
                            selectedFacility.user.id,
                          created_at: "",
                          users:
                            selectedFacility.user,
                        }
                      )
                    }
                    disabled={
                      removingFavoriteId !==
                      null
                    }
                    className="w-full border border-red-200 text-red-600 rounded-2xl p-4 font-bold disabled:opacity-50"
                  >
                    {removingFavoriteId
                      ? "解除しています..."
                      : "お気に入りから解除"}
                  </button>

                  <button
                    onClick={() =>
                      setSelectedFacility(null)
                    }
                    className="w-full bg-black text-white rounded-2xl p-4 font-bold"
                  >
                    閉じる
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}