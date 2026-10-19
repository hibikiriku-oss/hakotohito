
"use client";

import { useEffect, useRef, useState } from "react";
import { importLibrary, setOptions } from "@googlemaps/js-api-loader";

export default function MapTestPage() {
  const mapRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState("Google マップを読み込んでいます...");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function initializeMap() {
      try {
        const apiKey =
          process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

        if (!apiKey) {
          throw new Error(
            "Google Maps APIキーが設定されていません。.env.local を確認してください。"
          );
        }

        setOptions({
          key: apiKey,
          v: "weekly",
        });

        const mapsLibrary = (await importLibrary("maps")) as any;

        if (cancelled || !mapRef.current) return;

        new mapsLibrary.Map(mapRef.current, {
          center: { lat: 35.1815, lng: 136.9066 },
          zoom: 12,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
        });

        setStatus("Google マップを表示できました！");
      } catch (err) {
        console.error("Google Maps 読み込みエラー:", err);

        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Google マップの読み込みに失敗しました。"
          );
          setStatus("地図を表示できませんでした。");
        }
      }
    }

    initializeMap();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main
      style={{
        padding: 16,
        maxWidth: 900,
        margin: "0 auto",
      }}
    >
      <h1 style={{ fontSize: 24, fontWeight: "bold" }}>
        Google マップ表示テスト
      </h1>

      <p style={{ margin: "12px 0" }}>{status}</p>

      {error && (
        <p
          style={{
            color: "#c62828",
            background: "#ffebee",
            padding: 12,
            borderRadius: 8,
            overflowWrap: "anywhere",
          }}
        >
          {error}
        </p>
      )}

      <div
        ref={mapRef}
        style={{
          width: "100%",
          height: 450,
          borderRadius: 12,
          border: "1px solid #ccc",
        }}
      />

      <p style={{ marginTop: 12, color: "#666", fontSize: 14 }}>
        地図の拡大・縮小や移動ができるか確認してください。
      </p>
    </main>
  );
}
