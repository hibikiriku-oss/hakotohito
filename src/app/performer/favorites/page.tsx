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
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-md mx-auto">
          <h1 className="text-2xl font-bold">
            お気に入り
          </h1>

          <p className="mt-8 text-center text-gray-500">
            お気に入りを読み込んでいます...
          </p>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-md mx-auto">
          <button
            onClick={() =>
              router.push(
                "/performer/home"
              )
            }
            className="text-sm text-gray-500 mb-4"
          >
            ← ホームへ戻る
          </button>

          <h1 className="text-2xl font-bold">
            お気に入り
          </h1>

          <div className="mt-6 bg-red-50 rounded-xl p-4">
            <p className="text-red-600">
              {error}
            </p>
          </div>
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
              "/performer/home"
            )
          }
          className="text-sm text-gray-500 mb-4"
        >
          ← ホームへ戻る
        </button>

        <h1 className="text-2xl font-bold">
          お気に入り
        </h1>

        <p className="mt-2 text-sm text-gray-500">
          お気に入り登録した施設
        </p>

        {favorites.length === 0 ? (
          <div className="mt-8 bg-white rounded-2xl p-6 text-center shadow-sm">
            <p className="text-gray-500">
              まだお気に入りはありません。
            </p>

            <button
              onClick={() =>
                router.push(
                  "/performer/requests"
                )
              }
              className="w-full mt-5 bg-black text-white rounded-xl p-4 font-bold"
            >
              案件を探す
            </button>
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            {favorites.map((favorite) => {
              const user =
                getFavoriteUser(favorite);

              const facility =
                getFavoriteFacility(user);

              const isRemoving =
                removingFavoriteId ===
                favorite.id;

              return (
                <div
                  key={favorite.id}
                  className="bg-white rounded-2xl p-4 shadow-sm"
                >
                  <div className="flex items-center gap-4">

                    {user?.picture_url ? (
                      <img
                        src={user.picture_url}
                        alt=""
                        className="w-14 h-14 rounded-full object-cover"
                      />
                    ) : (
                      <div className="w-14 h-14 rounded-full bg-gray-200 flex items-center justify-center text-2xl">
                        🏢
                      </div>
                    )}

                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-lg truncate">
                        {facility?.name ||
                          user?.display_name ||
                          "施設"}
                      </p>

                      <p className="text-sm text-gray-500 mt-1">
                        {facility?.facility_type ||
                          "施設"}
                      </p>
                    </div>

                  </div>

                  <button
                    onClick={() =>
                      handleFacilityProfile(
                        favorite
                      )
                    }
                    className="w-full mt-4 border border-gray-300 rounded-xl p-3 font-bold"
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
                    className="w-full mt-3 border border-red-300 text-red-600 rounded-xl p-3 font-bold disabled:opacity-50"
                  >
                    {isRemoving
                      ? "解除しています..."
                      : "⭐ お気に入り解除"}
                  </button>
                </div>
              );
            })}
          </div>
        )}

      </div>

      {selectedFacility && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-end justify-center"
          onClick={() =>
            setSelectedFacility(null)
          }
        >
          <div
            className="w-full max-w-md bg-white rounded-t-3xl p-6 max-h-[85vh] overflow-y-auto"
            onClick={(event) =>
              event.stopPropagation()
            }
          >
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold">
                施設プロフィール
              </h2>

              <button
                onClick={() =>
                  setSelectedFacility(null)
                }
                className="text-gray-500 text-2xl leading-none"
              >
                ×
              </button>
            </div>

            <div className="mt-6 flex items-center gap-4">
              {selectedFacility.user
                .picture_url ? (
                <img
                  src={
                    selectedFacility.user
                      .picture_url
                  }
                  alt=""
                  className="w-16 h-16 rounded-full object-cover"
                />
              ) : (
                <div className="w-16 h-16 rounded-full bg-gray-200 flex items-center justify-center text-3xl">
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

            <div className="mt-6 space-y-5">

              <div>
                <p className="text-sm font-bold text-gray-500">
                  📍 住所
                </p>

                <p className="mt-1 text-gray-800">
                  {selectedFacility.facility
                    .address ||
                    "住所は登録されていません"}
                </p>
              </div>

              <div>
                <p className="text-sm font-bold text-gray-500">
                  📝 施設について
                </p>

                <p className="mt-1 text-gray-800 whitespace-pre-wrap">
                  {selectedFacility.facility
                    .description ||
                    "施設の説明は登録されていません"}
                </p>
              </div>

              <div>
                <p className="text-sm font-bold text-gray-500">
                  ⭐ お気に入り
                </p>

                <p className="mt-1 text-gray-800">
                  この施設をお気に入り登録しています。
                </p>
              </div>

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
                className="w-full border border-red-300 text-red-600 rounded-xl p-4 font-bold disabled:opacity-50"
              >
                {removingFavoriteId
                  ? "解除しています..."
                  : "⭐ お気に入り解除"}
              </button>

            </div>

            <button
              onClick={() =>
                setSelectedFacility(null)
              }
              className="w-full mt-4 bg-black text-white rounded-xl p-4 font-bold"
            >
              閉じる
            </button>
          </div>
        </div>
      )}

    </main>
  );
}