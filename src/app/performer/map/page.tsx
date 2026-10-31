"use client";

import { requireLineIdToken } from "@/lib/require-line-id-token";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import liff from "@line/liff";
import { importLibrary, setOptions } from "@googlemaps/js-api-loader";

type MapItem = {
  id: string;
  title: string;
  description?: string | null;
  map_type: "performance" | "lesson";
  map_address?: string | null;
  area?: string | null;
  performance_date?: string | null;
  lesson_date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  reward?: number | null;
  lesson_fee?: number | null;
  is_applied?: boolean;
  application_status?: string | null;
  facilities?: {
    name?: string | null;
    facility_type?: string | null;
    address?: string | null;
  } | null;
  performers?: {
    area?: string | null;
    areas?: string[] | null;
  } | null;
};

type MapSearchResponse = {
  success: boolean;
  date: string | null;
  startDate?: string | null;
  endDate?: string | null;
  performances: MapItem[];
  lessons: MapItem[];
  total: number;
  error?: string;
};

const instrumentOptions = [
  "ピアノ",
  "ギター",
  "ベース",
  "ドラム",
  "サックス",
  "バイオリン",
  "その他",
];

const genreOptions = [
  "ポップス",
  "ロック",
  "ジャズ",
  "クラシック",
  "その他",
];

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };

    return entities[char];
  });
}

function formatTime(value?: string | null): string {
  return value ? value.slice(0, 5) : "";
}

function getInitialSearchValues() {
  if (typeof window === "undefined") {
    return {
      startDate: "",
      endDate: "",
      startTime: "",
      endTime: "",
      instruments: [] as string[],
      genres: [] as string[],
    };
  }

  const params = new URLSearchParams(window.location.search);
  const oldDate = params.get("date") || "";

  return {
    startDate: params.get("startDate") || oldDate,
    endDate: params.get("endDate") || oldDate,
    startTime: params.get("startTime") || "",
    endTime: params.get("endTime") || "",
    instruments: params.get("instruments")
      ? params.get("instruments")!.split(",").filter(Boolean)
      : [],
    genres: params.get("genres")
      ? params.get("genres")!.split(",").filter(Boolean)
      : [],
  };
}

export default function PerformerMapPage() {
  const router = useRouter();
  const mapRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<any[]>([]);

  const [status, setStatus] = useState("LINE認証を確認しています...");
  const [error, setError] = useState("");
  const [total, setTotal] = useState(0);
  const [shown, setShown] = useState(0);

  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [selectedInstruments, setSelectedInstruments] = useState<string[]>([]);
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [filtersInitialized, setFiltersInitialized] = useState(false);

  useEffect(() => {
    const values = getInitialSearchValues();

    setStartDate(values.startDate);
    setEndDate(values.endDate);
    setStartTime(values.startTime);
    setEndTime(values.endTime);
    setSelectedInstruments(values.instruments);
    setSelectedGenres(values.genres);
    setFiltersInitialized(true);
  }, []);

  function toggleSelection(
    value: string,
    current: string[],
    setter: (values: string[]) => void
  ) {
    setter(
      current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value]
    );
  }

  function handleSearch() {
    setError("");

    if (startDate && endDate && startDate > endDate) {
      setError("終了日は開始日以降の日付を指定してください。");
      return;
    }

    if (startTime && endTime && startTime >= endTime) {
      setError("終了時間は開始時間より後にしてください。");
      return;
    }

    const params = new URLSearchParams();

    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);

    if (startTime && endTime) {
      params.set("startTime", startTime);
      params.set("endTime", endTime);
    }

    if (selectedInstruments.length > 0) {
      params.set("instruments", selectedInstruments.join(","));
    }

    if (selectedGenres.length > 0) {
      params.set("genres", selectedGenres.join(","));
    }

    const query = params.toString();

    window.location.assign(
      query ? `/performer/map?${query}` : "/performer/map"
    );
  }

  useEffect(() => {
    if (!filtersInitialized) return;

    let cancelled = false;

    async function initialize() {
      try {
        await liff.init({
          liffId: process.env.NEXT_PUBLIC_LIFF_ID!,
          withLoginOnExternalBrowser: true,
        });

        if (cancelled) return;

        if (!liff.isLoggedIn()) {
          liff.login();
          return;
        }

        try {
          await liff.getProfile();
        } catch (profileError) {
          console.error("LINEプロフィール取得エラー:", profileError);

          const message =
            profileError instanceof Error
              ? profileError.message
              : String(profileError);

          if (/access token expired|invalid access token/i.test(message)) {
            setStatus("LINEの認証を更新しています...");
            liff.logout();
            liff.login();
            return;
          }

          throw profileError;
        }

        if (cancelled || !mapRef.current) return;

        const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

        if (!apiKey) {
          throw new Error(
            "Google Maps APIキーが設定されていません。.env.localを確認してください。"
          );
        }

        setOptions({
          key: apiKey,
          v: "weekly",
        });

        const mapsLibrary: any = await importLibrary("maps");
        const geocodingLibrary: any = await importLibrary("geocoding");

        if (cancelled || !mapRef.current) return;

        const map = new mapsLibrary.Map(mapRef.current, {
          center: { lat: 35.1815, lng: 136.9066 },
          zoom: 11,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
        });

        const params = new URLSearchParams(window.location.search);
        const searchParams = new URLSearchParams();

        const requestedStartDate = params.get("startDate");
        const requestedEndDate = params.get("endDate");
        const oldDate = params.get("date");

        if (requestedStartDate) {
          searchParams.set("startDate", requestedStartDate);
        } else if (oldDate) {
          searchParams.set("startDate", oldDate);
        }

        if (requestedEndDate) {
          searchParams.set("endDate", requestedEndDate);
        } else if (oldDate) {
          searchParams.set("endDate", oldDate);
        }

        for (const key of [
          "startTime",
          "endTime",
          "instruments",
          "genres",
        ]) {
          const value = params.get(key);
          if (value) searchParams.set(key, value);
        }

        const query = searchParams.toString();
        const searchUrl = query
          ? `/api/map-search?${query}`
          : "/api/map-search";

        const response = await fetch(searchUrl, {
          headers: {
            Authorization: `Bearer ${requireLineIdToken(liff.getIDToken())}`,
          },
          cache: "no-store",
        });

        const data: MapSearchResponse = await response.json();

        if (!response.ok || !data.success) {
          throw new Error(
            data.error || "地図検索データを取得できませんでした。"
          );
        }

        if (cancelled) return;

        setTotal(data.total);
        setStatus("案件の位置を検索しています...");

        const items: MapItem[] = [
          ...(data.performances || []),
          ...(data.lessons || []),
        ];

        const geocoder = new geocodingLibrary.Geocoder();
        const infoWindow = new mapsLibrary.InfoWindow();

        let displayedCount = 0;
        let missingAddressCount = 0;
        let geocodeFailedCount = 0;
        let geocodeSuccessCount = 0;

        for (const item of items) {
          if (cancelled) return;

          const address =
            item.map_type === "performance"
              ? item.map_address || item.facilities?.address
              : item.area?.trim() ||
                item.performers?.areas?.find((area) => area?.trim())?.trim() ||
                item.performers?.area?.trim();

          if (!address?.trim()) {
            missingAddressCount++;
            console.warn("[地図診断] 住所・エリアなし:", {
              id: item.id,
              type: item.map_type,
              title: item.title,
              area: item.area,
              performerArea: item.performers?.area,
              performerAreas: item.performers?.areas,
              facilityAddress: item.facilities?.address,
            });
            continue;
          }

          try {
            const result = await geocoder.geocode({
              address: address.trim(),
              region: "JP",
            });

            if (cancelled) return;

            const location = result.results?.[0]?.geometry?.location;

            if (!location) {
              geocodeFailedCount++;
              console.warn("[地図診断] 座標を取得できません:", {
                id: item.id,
                title: item.title,
                address,
                geocodeStatus: result.status,
              });
              continue;
            }

            geocodeSuccessCount++;

            const isPerformance = item.map_type === "performance";

            const detailPath = isPerformance
              ? `/performer/requests/${encodeURIComponent(item.id)}`
              : `/performer/lesson/${encodeURIComponent(item.id)}`;

            const marker = new (window as any).google.maps.Marker({
              map,
              position: location,
              title: item.title,
              label: {
                text: isPerformance ? "演" : "レ",
                color: "#ffffff",
                fontSize: "12px",
              },
              icon: {
                path: "M 0,-18 C -10,-18 -17,-10 -17,0 C -17,10 0,25 0,25 C 0,25 17,10 17,0 C 17,-10 10,-18 0,-18 Z",
                fillColor: isPerformance ? "#2563eb" : "#16a34a",
                fillOpacity: 1,
                strokeColor: "#ffffff",
                strokeWeight: 2,
                scale: 1,
              },
            });

            marker.addListener("click", () => {
              const title = escapeHtml(item.title || "タイトルなし");
              const locationText = escapeHtml(address);
              const typeLabel = isPerformance ? "演奏案件" : "レッスン募集";

              const facilityName = item.facilities?.name
                ? `<p>施設名：${escapeHtml(item.facilities.name)}</p>`
                : "";

              const dateValue = isPerformance
                ? item.performance_date
                : item.lesson_date;

              const dateText = dateValue ? escapeHtml(dateValue) : "未指定";

              const itemStartTime = formatTime(item.start_time);
              const itemEndTime = formatTime(item.end_time);

              const timeText =
                itemStartTime || itemEndTime
                  ? `${escapeHtml(itemStartTime || "未指定")} ～ ${escapeHtml(itemEndTime || "未指定")}`
                  : "時間未指定";

              const price =
                isPerformance && item.reward != null
                  ? `<p>謝礼：${item.reward.toLocaleString("ja-JP")}円</p>`
                  : !isPerformance && item.lesson_fee != null
                    ? `<p>レッスン料金：${item.lesson_fee.toLocaleString("ja-JP")}円</p>`
                    : "";

              const applicationText = item.is_applied
                ? `<p style="color:#2563eb;font-weight:bold">応募済み${item.application_status ? `（${escapeHtml(item.application_status)}）` : ""}</p>`
                : "";

              const approximationText = !isPerformance
                ? '<p style="color:#64748b;font-size:12px">※登録エリアをもとにしたおおよその位置です。</p>'
                : "";

              const content = `
                <div style="max-width:260px;font-size:14px;line-height:1.6">
                  <strong>${title}</strong>
                  <p>${typeLabel}</p>
                  ${facilityName}
                  <p>日付：${dateText}</p>
                  <p>時間：${timeText}</p>
                  <p>場所：${locationText}</p>
                  ${price}
                  ${applicationText}
                  ${approximationText}
                  <a href="${detailPath}" style="display:inline-block;margin-top:6px;color:#2563eb;font-weight:bold">
                    詳細を見る →
                  </a>
                </div>
              `;

              infoWindow.setContent(content);
              infoWindow.open({
                map,
                anchor: marker,
              });
            });

            markersRef.current.push(marker);
            displayedCount++;
          } catch (geocodeError) {
            console.warn(
              "住所を地図上で特定できませんでした:",
              address,
              geocodeError
            );
          }
        }

        if (cancelled) return;

        setShown(displayedCount);

        console.log("[地図診断] 集計結果:", {
          検索対象: items.length,
          住所なし: missingAddressCount,
          住所検索成功: geocodeSuccessCount,
          住所検索失敗: geocodeFailedCount,
          地図表示: displayedCount,
        });

        if (displayedCount > 0) {
          const bounds = new (window as any).google.maps.LatLngBounds();

          for (const marker of markersRef.current) {
            const position = marker.getPosition();
            if (position) bounds.extend(position);
          }

          map.fitBounds(bounds);

          if (displayedCount === 1) {
            map.setZoom(13);
          }
        }

        setStatus(
          displayedCount > 0
            ? "地図を表示しました。"
            : "表示できる場所が見つかりませんでした。"
        );
      } catch (err) {
        console.error("地図検索エラー:", err);

        if (!cancelled) {
          const message =
            err instanceof Error ? err.message : String(err);

          setError(message || "地図の読み込みに失敗しました。");
          setStatus("地図を表示できませんでした。");
        }
      }
    }

    initialize();

    return () => {
      cancelled = true;

      for (const marker of markersRef.current) {
        marker.setMap(null);
      }

      markersRef.current = [];
    };
  }, [filtersInitialized]);

  const compactLabelStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 5,
    padding: "5px 8px",
    background: "#fff",
    border: "1px solid #e2e8f0",
    borderRadius: 6,
    whiteSpace: "nowrap",
  };

  return (
    <main
      style={{
        maxWidth: 900,
        margin: "0 auto",
        padding: 12,
        color: "#222",
      }}
    >
      <button
        type="button"
        onClick={() => router.push("/performer/home")}
        style={{
          padding: "7px 11px",
          marginBottom: 8,
          border: "1px solid #ddd",
          borderRadius: 8,
          background: "#fff",
          cursor: "pointer",
        }}
      >
        ← ホームに戻る
      </button>

      <h1
        style={{
          fontSize: 22,
          fontWeight: "bold",
          marginBottom: 8,
        }}
      >
        地図から探す
      </h1>

      <div
        style={{
          display: "flex",
          gap: 14,
          flexWrap: "wrap",
          fontSize: 13,
          marginBottom: 8,
        }}
      >
        <span>
          <strong style={{ color: "#2563eb" }}>●</strong> 演奏案件
        </span>
        <span>
          <strong style={{ color: "#16a34a" }}>●</strong> レッスン募集
        </span>
      </div>

      {/* 地図の案内・表示件数 */}
      <div
        style={{
          padding: 10,
          background: "#f8fafc",
          border: "1px solid #e2e8f0",
          borderRadius: 8,
          marginBottom: 8,
          fontSize: 13,
          lineHeight: 1.8,
        }}
      >
        <p>{status}</p>
        <p>地図表示：{shown}件</p>
        <p>マーカーを押すと詳細を確認できます。</p>

        {error && (
          <p style={{ color: "#dc2626", marginTop: 6 }}>
            エラー：{error}
          </p>
        )}
      </div>

      {/* 地図を検索条件より上に配置 */}
      <div
        ref={mapRef}
        style={{
          width: "100%",
          height: 420,
          borderRadius: 12,
          border: "1px solid #ddd",
          background: "#f1f5f9",
          marginBottom: 12,
        }}
      />

      <div
        style={{
          padding: 12,
          background: "#f8fafc",
          border: "1px solid #e2e8f0",
          borderRadius: 10,
          marginBottom: 12,
          fontSize: 13,
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: "bold", marginBottom: 10 }}>
          検索条件
        </h2>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 8,
            marginBottom: 6,
          }}
        >
          <label htmlFor="map-start-date">開始日</label>
          <input
            id="map-start-date"
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
            style={{
              padding: 6,
              border: "1px solid #cbd5e1",
              borderRadius: 6,
              background: "#fff",
            }}
          />

          <label htmlFor="map-end-date">終了日</label>
          <input
            id="map-end-date"
            type="date"
            value={endDate}
            onChange={(event) => setEndDate(event.target.value)}
            style={{
              padding: 6,
              border: "1px solid #cbd5e1",
              borderRadius: 6,
              background: "#fff",
            }}
          />
        </div>

        <p style={{ color: "#64748b", fontSize: 11, marginBottom: 10 }}>
          開始日のみ・終了日のみでも検索できます。両方未指定の場合は今日以降が対象です。
        </p>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 8,
            marginBottom: 5,
          }}
        >
          <label htmlFor="map-start-time">開始時間</label>
          <input
            id="map-start-time"
            type="time"
            value={startTime}
            onChange={(event) => setStartTime(event.target.value)}
            style={{
              padding: 6,
              border: "1px solid #cbd5e1",
              borderRadius: 6,
              background: "#fff",
            }}
          />

          <label htmlFor="map-end-time">終了時間</label>
          <input
            id="map-end-time"
            type="time"
            value={endTime}
            onChange={(event) => setEndTime(event.target.value)}
            style={{
              padding: 6,
              border: "1px solid #cbd5e1",
              borderRadius: 6,
              background: "#fff",
            }}
          />
        </div>

        <p style={{ color: "#64748b", fontSize: 11, marginBottom: 10 }}>
          時間帯は開始・終了の両方を指定した場合のみ適用されます。
        </p>

        <div style={{ marginBottom: 10 }}>
          <strong style={{ display: "block", marginBottom: 6 }}>
            楽器（複数選択可）
          </strong>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {instrumentOptions.map((instrument) => (
              <label key={instrument} style={compactLabelStyle}>
                <input
                  type="checkbox"
                  checked={selectedInstruments.includes(instrument)}
                  onChange={() =>
                    toggleSelection(
                      instrument,
                      selectedInstruments,
                      setSelectedInstruments
                    )
                  }
                />
                {instrument}
              </label>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <strong style={{ display: "block", marginBottom: 6 }}>
            ジャンル（複数選択可）
          </strong>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {genreOptions.map((genre) => (
              <label key={genre} style={compactLabelStyle}>
                <input
                  type="checkbox"
                  checked={selectedGenres.includes(genre)}
                  onChange={() =>
                    toggleSelection(
                      genre,
                      selectedGenres,
                      setSelectedGenres
                    )
                  }
                />
                {genre}
              </label>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button
            type="button"
            onClick={handleSearch}
            style={{
              padding: "9px 18px",
              border: "none",
              borderRadius: 8,
              background: "#2563eb",
              color: "#fff",
              fontWeight: "bold",
              cursor: "pointer",
            }}
          >
            この条件で検索
          </button>

          <button
            type="button"
            onClick={() => {
              setStartDate("");
              setEndDate("");
              setStartTime("");
              setEndTime("");
              setSelectedInstruments([]);
              setSelectedGenres([]);
              window.location.assign("/performer/map");
            }}
            style={{
              padding: "9px 14px",
              border: "1px solid #cbd5e1",
              borderRadius: 8,
              background: "#fff",
              color: "#334155",
              cursor: "pointer",
            }}
          >
            条件をクリア
          </button>
        </div>
      </div>

      <p
        style={{
          marginTop: 8,
          fontSize: 11,
          color: "#666",
          lineHeight: 1.6,
        }}
      >
        ※レッスン募集は登録されたエリアをもとに位置を表示するため、正確な所在地とは限りません。
        住所やエリアが登録されていない案件は地図に表示されません。
      </p>
    </main>
  );
}