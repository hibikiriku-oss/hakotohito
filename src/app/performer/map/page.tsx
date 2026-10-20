
"use client";

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
  date: string;
  performances: MapItem[];
  lessons: MapItem[];
  total: number;
  error?: string;
};

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

export default function PerformerMapPage() {
  const router = useRouter();
  const mapRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<any[]>([]);

  const [status, setStatus] = useState("LINE認証を確認しています...");
  const [error, setError] = useState("");
  const [total, setTotal] = useState(0);
  const [shown, setShown] = useState(0);
  const [date, setDate] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      try {
        // LINE認証を初期化
        await liff.init({
          liffId: process.env.NEXT_PUBLIC_LIFF_ID!,
          withLoginOnExternalBrowser: true,
        });

        if (cancelled) return;

        // 未ログインの場合はLINEログインへ
        if (!liff.isLoggedIn()) {
          liff.login();
          return;
        }

        let profile;

        try {
          profile = await liff.getProfile();
        } catch (profileError) {
          console.error("LINEプロフィール取得エラー:", profileError);

          const message =
            profileError instanceof Error
              ? profileError.message
              : String(profileError);

          if (
            /access token expired|invalid access token/i.test(message)
          ) {
            setStatus("LINEの認証を更新しています...");

            liff.logout();
            liff.login();
            return;
          }

          throw profileError;
        }

        if (cancelled || !mapRef.current) return;

        // Google Maps APIキーを確認
        const apiKey =
          process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

        if (!apiKey) {
          throw new Error(
            "Google Maps APIキーが設定されていません。.env.localを確認してください。"
          );
        }

        // Google Mapsを読み込む
        setOptions({
          key: apiKey,
          v: "weekly",
        });

        const mapsLibrary: any = await importLibrary("maps");
        const geocodingLibrary: any =
          await importLibrary("geocoding");

        if (cancelled || !mapRef.current) return;

        const map = new mapsLibrary.Map(mapRef.current, {
          center: { lat: 35.1815, lng: 136.9066 },
          zoom: 11,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
        });

        // 地図検索APIを呼び出す
        const response = await fetch("/api/map-search", {
          headers: {
            "x-line-user-id": profile.userId,
          },
          cache: "no-store",
        });

        const data: MapSearchResponse = await response.json();

        if (!response.ok || !data.success) {
          throw new Error(
            data.error ||
              "地図検索データを取得できませんでした。"
          );
        }

        if (cancelled) return;

        setDate(data.date);
        setTotal(data.total);
        setStatus("案件の位置を検索しています...");

        const items: MapItem[] = [
          ...(data.performances || []),
          ...(data.lessons || []),
        ];

        const geocoder = new geocodingLibrary.Geocoder();
        const infoWindow = new mapsLibrary.InfoWindow();

        let displayedCount = 0;

        for (const item of items) {
          if (cancelled) return;

          // 演奏案件は施設住所、レッスンは登録エリアを使用
          const address =
            item.map_type === "performance"
              ? item.map_address || item.facilities?.address
              : item.area?.trim() ||
                item.performers?.areas?.find((area) => area?.trim())?.trim() ||
                item.performers?.area?.trim();

          if (!address?.trim()) continue;

          try {
            const result = await geocoder.geocode({
              address: address.trim(),
              region: "JP",
            });

            if (cancelled) return;

            const location =
              result.results?.[0]?.geometry?.location;

            if (!location) continue;

            const isPerformance =
              item.map_type === "performance";

            const detailPath = isPerformance
              ? `/performer/requests/${encodeURIComponent(item.id)}`
              : `/performer/lesson/${encodeURIComponent(item.id)}`;

            const marker = new mapsLibrary.Marker({
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
                fillColor: isPerformance
                  ? "#2563eb"
                  : "#16a34a",
                fillOpacity: 1,
                strokeColor: "#ffffff",
                strokeWeight: 2,
                scale: 1,
                labelOrigin: new mapsLibrary.Point(0, -1),
              },
            });

            marker.addListener("click", () => {
              const title = escapeHtml(
                item.title || "タイトルなし"
              );
              const locationText = escapeHtml(address);
              const typeLabel = isPerformance
                ? "演奏案件"
                : "レッスン募集";

              const facilityName = item.facilities?.name
                ? `<p>施設名：${escapeHtml(item.facilities.name)}</p>`
                : "";

              const dateValue = isPerformance
                ? item.performance_date
                : item.lesson_date;

              const dateText = dateValue
                ? escapeHtml(dateValue)
                : "未指定";

              const startTime = formatTime(item.start_time);
              const endTime = formatTime(item.end_time);

              const timeText =
                startTime || endTime
                  ? `${escapeHtml(startTime || "未指定")} ～ ${escapeHtml(endTime || "未指定")}`
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
            // 1件の位置が特定できなくても、残りの案件を処理する
            console.warn(
              "住所を地図上で特定できませんでした:",
              address,
              geocodeError
            );
          }
        }

        if (cancelled) return;

        setShown(displayedCount);

        if (displayedCount > 0) {
          const bounds = new mapsLibrary.LatLngBounds();

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
            err instanceof Error
              ? err.message
              : String(err);

          setError(
            message || "地図の読み込みに失敗しました。"
          );
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
  }, []);

  return (
    <main
      style={{
        maxWidth: 900,
        margin: "0 auto",
        padding: 16,
        color: "#222",
      }}
    >
      <button
        type="button"
        onClick={() => router.push("/performer/home")}
        style={{
          padding: "8px 12px",
          marginBottom: 12,
          border: "1px solid #ddd",
          borderRadius: 8,
          background: "#fff",
          cursor: "pointer",
        }}
      >
        ← 演奏者ホームへ戻る
      </button>

      <h1
        style={{
          fontSize: 24,
          fontWeight: "bold",
          marginBottom: 8,
        }}
      >
        地図から探す
      </h1>

      <p
        style={{
          fontSize: 14,
          color: "#555",
          marginBottom: 12,
        }}
      >
        今日の演奏案件とレッスン募集を地図で確認できます。
      </p>

      <div
        style={{
          display: "flex",
          gap: 16,
          flexWrap: "wrap",
          fontSize: 14,
          marginBottom: 12,
        }}
      >
        <span>
          <strong style={{ color: "#2563eb" }}>●</strong>{" "}
          演奏案件
        </span>
        <span>
          <strong style={{ color: "#16a34a" }}>●</strong>{" "}
          レッスン募集
        </span>
        <span>マーカーを押すと案件の詳細を確認できます。</span>
      </div>

      <div
        style={{
          padding: 12,
          background: "#f8fafc",
          borderRadius: 8,
          marginBottom: 12,
          fontSize: 14,
        }}
      >
        <p>対象日：{date || "読み込み中..."}</p>
        <p>検索対象：{total}件</p>
        <p>地図表示：{shown}件</p>
        <p>{status}</p>

        {error && (
          <p style={{ color: "#dc2626", marginTop: 8 }}>
            エラー：{error}
          </p>
        )}
      </div>

      <div
        ref={mapRef}
        style={{
          width: "100%",
          height: 480,
          borderRadius: 12,
          border: "1px solid #ddd",
          background: "#f1f5f9",
        }}
      />

      <p
        style={{
          marginTop: 10,
          fontSize: 12,
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
