export default function FacilityHomePage() {
  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-md mx-auto">

        <h1 className="text-2xl font-bold">
          🏢 施設ホーム
        </h1>

        <p className="mt-4 text-gray-600">
          演奏者を募集したり、応募者を確認できます。
        </p>

        <div className="mt-8 space-y-3">

          <button className="w-full bg-black text-white rounded-xl p-4">
            🎵 演奏依頼を作成する
          </button>

          <button className="w-full bg-white border rounded-xl p-4">
            📋 自分の依頼を見る
          </button>

        </div>

      </div>
    </main>
  );
}