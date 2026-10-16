/**
 * 演奏者の活動エリアと施設案件のエリアを照合する。
 * 単純な部分一致ではなく、地域の階層を考慮する。
 */

function normalizeArea(value: string): string {
  return value.normalize("NFKC").replace(/[ 　\t]/g, "").trim();
}

const PREFECTURE_PATTERN =
  /^(北海道|東京都|大阪府|京都府|.{2,3}県)/;

function getPrefecture(area: string): string {
  return area.match(PREFECTURE_PATTERN)?.[0] ?? "";
}

export function areaMatches(
  performerArea: string,
  requestArea: string
): boolean {
  const performer = normalizeArea(performerArea);
  const request = normalizeArea(requestArea);

  if (!performer || !request) return false;
  if (performer === request) return true;

  const performerPrefecture = getPrefecture(performer);
  const requestPrefecture = getPrefecture(request);

  // 都道府県が異なる場合は一致しない。
  if (
    !performerPrefecture ||
    !requestPrefecture ||
    performerPrefecture !== requestPrefecture
  ) {
    return false;
  }

  // 案件エリアが演奏者の活動エリアの先頭と一致すること。
  if (!performer.startsWith(request)) return false;

  const remainder = performer.slice(request.length);

  // 市の案件に対して、その市内の区を活動エリアにしている場合。
  // 例: 名古屋市 + 千種区、名古屋市 + 中区
  if (request.endsWith("市")) {
    return /^[^市区町村]+区(?:.*)?$/.test(remainder);
  }

  // 区・町・村などの上位地域と、その配下の地域を照合する。
  // ただし、別の市や単なる文字列の部分一致は許可しない。
  if (request.endsWith("区")) {
    return remainder.length > 0;
  }

  if (request.endsWith("町") || request.endsWith("村")) {
    return remainder.length > 0;
  }

  return false;
}