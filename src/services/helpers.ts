export function buildPanoramaxUrls(pictureId: string, instanceUrl: string): { sdUrl: string; hdUrl: string; thumbUrl: string } {
  if (pictureId.startsWith('http://') || pictureId.startsWith('https://')) {
    return { sdUrl: pictureId, hdUrl: pictureId, thumbUrl: pictureId };
  }
  const hex = pictureId.replace(/[^a-f0-9]/gi, '').toLowerCase();
  const base = instanceUrl.replace(/\/api\/?$/, '').replace(/\/$/, '');
  if (hex.length >= 32) {
    const p1 = hex.slice(0, 2), p2 = hex.slice(2, 4), p3 = hex.slice(4, 6), p4 = hex.slice(6, 8);
    const rest = pictureId.toLowerCase().replace(/^[a-f0-9]{8}-/, '');
    return {
      hdUrl: `${base}/permanent/${p1}/${p2}/${p3}/${p4}/${rest}.jpg`,
      sdUrl: `${base}/derivatives/${p1}/${p2}/${p3}/${p4}/${rest}/sd.jpg`,
      thumbUrl: `${base}/derivatives/${p1}/${p2}/${p3}/${p4}/${rest}/thumb.jpg`,
    };
  }
  const apiBase = instanceUrl.replace(/\/$/, '');
  return {
    sdUrl: `${apiBase}/pictures/${pictureId}/sd.jpg`,
    hdUrl: `${apiBase}/pictures/${pictureId}/hd.jpg`,
    thumbUrl: `${apiBase}/pictures/${pictureId}/thumb.jpg`,
  };
}

export function cleanPictureId(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  const uuidMatch = trimmed.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i);
  if (uuidMatch) return uuidMatch[0].toLowerCase();
  let cleaned = trimmed.replace(/^https?:\/\/[^\/]+/, '');
  cleaned = cleaned.replace(/\/pictures\//, '');
  cleaned = cleaned.replace(/\/sd\.jpg$/, '');
  cleaned = cleaned.replace(/\/hd\.jpg$/, '');
  cleaned = cleaned.replace(/\/thumb\.jpg$/, '');
  cleaned = cleaned.replace(/[\/\s]/g, '');
  return cleaned.toLowerCase();
}

export function isMockId(id: string): boolean {
  return /^mock_/.test(id);
}
