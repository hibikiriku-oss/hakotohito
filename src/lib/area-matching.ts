/**
 * 演奏者の活動エリアと施設案件のエリアを照合する。
 * 市と区など、地域の階層が異なる場合も照合する。
 */

function normalizeArea(value: string): string {
  return value.normalize("NFKC").replace(/[ 　\t]/g, "").trim();
}

const PREFECTURE_PATTERN =
  /^(北海道|東京都|大阪府|京都府|.{2,3}県)/;

function getPrefecture(area: string): string {
  return area.match(PREFECTURE_PATTERN)?.[0] ?? "";
}

/**
 * parent が child の上位地域に当たるかを判定する。
 */
function isParentArea(parent: string, child: string): boolean {
  if (!parent || !child || !child.startsWith(parent)) {
    return false;
  }

  const remainder = child.slice(parent.length);

  if (!remainder) {
    return true;
  }

  // 都道府県単位の活動エリアは、その都道府県内の地域を含む。
  if (
    parent.endsWith("県") ||
    parent.endsWith("府") ||
    parent.endsWith("都") ||
    parent.endsWith("道")
  ) {
    return true;
  }

  // 市の活動エリアと、その市内の区を照合する。
  if (parent.endsWith("市")) {
    return /^[^市区町村]+区(?:.*)?$/.test(remainder);
  }

  // 区・町・村の配下にある地域を照合する。
  if (
    parent.endsWith("区") ||
    parent.endsWith("町") ||
    parent.endsWith("村")
  ) {
    return true;
  }

  return false;
}

export function areaMatches(
  performerArea: string,
  requestArea: string
): boolean {
  const performer = normalizeArea(performerArea);
  const request = normalizeArea(requestArea);

  if (!performer || !request) {
    return false;
  }

  if (performer === request) {
    return true;
  }

  const performerPrefecture = getPrefecture(performer);
  const requestPrefecture = getPrefecture(request);

  // 都道府県が異なる場合、または都道府県を判定できない場合は一致しない。
  if (
    !performerPrefecture ||
    !requestPrefecture ||
    performerPrefecture !== requestPrefecture
  ) {
    return false;
  }

  // 演奏者の活動エリアが案件エリアを含む場合、
  // または案件エリアが活動エリアを含む場合に一致とする。
  return (
    isParentArea(performer, request) ||
    isParentArea(request, performer)
  );
}