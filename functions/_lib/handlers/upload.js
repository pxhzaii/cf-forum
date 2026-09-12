import { json, error, getLoginUser } from '../util.js';

// 图片 MIME 白名单（可内联渲染）
const IMAGE_TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};
// 文件 MIME 白名单（强制下载，不在浏览器执行）
const FILE_TYPES = {
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/zip': 'zip',
  'application/x-zip-compressed': 'zip',
  'application/x-7z-compressed': '7z',
  'application/vnd.rar': 'rar',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'video/mp4': 'mp4',
};
const MAX_SIZE = 50 * 1024 * 1024; // 50MB

// 图片魔数校验：防伪装（如 exe 改名成 png）
function sniffImage(buf) {
  const b = new Uint8Array(buf, 0, 12);
  // PNG: 89 50 4E 47
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'image/png';
  // JPEG: FF D8 FF
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image/jpeg';
  // GIF: GIF8
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif';
  // WebP: RIFF....WEBP
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
}

// 清洗文件名：去路径、去控制字符，只留安全字符
function safeName(name) {
  return String(name || 'file')
    .replace(/[\\/:*?"<>|\r\n\t]/g, '_')   // 非法字符
    .replace(/[\x00-\x1f]/g, '')           // 控制字符
    .slice(0, 100)                          // 长度限制
    .trim() || 'file';
}

// 上传（图片或文件）：multipart/form-data，字段名 file；存入 R2
export async function upload(request, env) {
  const user = await getLoginUser(request, env);
  if (!user) return error('未登录', 401);
  if (!env.IMG_BUCKET) return error('存储未配置', 500);

  let form;
  try { form = await request.formData(); } catch { return error('请求格式错误'); }
  const file = form.get('file');
  if (!file || typeof file === 'string') return error('请选择文件');

  const isImage = !!IMAGE_TYPES[file.type];
  const ext = isImage ? IMAGE_TYPES[file.type] : FILE_TYPES[file.type];
  if (!ext) return error('仅支持 png/jpg/gif/webp 图片，或 pdf/txt/office 文档、zip/7z/rar 压缩包、mp3/wav/mp4 音视频');
  if (file.size > MAX_SIZE) return error('文件不能超过 50MB');

  // 图片做魔数校验（防伪装）；非图片文件以扩展名+MIME 白名单为准，响应强制下载头，无执行风险
  if (isImage) {
    const head = await file.slice(0, 12).arrayBuffer();
    const sniffed = sniffImage(head);
    if (sniffed !== file.type) {
      // webp 的 MIME 可能写作 image/webp 一致，GIF/JPEG/PNG 严格匹配；不一致即拒绝
      return error('文件内容与图片格式不符，可能已损坏或被伪装');
    }
  }

  // key: img/ 或 file/<uid>/<时间戳><随机>.<ext>
  const prefix = isImage ? 'img' : 'file';
  const key = `${prefix}/${user.id}/${Date.now()}${Math.floor(Math.random() * 10000)}.${ext}`;
  await env.IMG_BUCKET.put(key, file.stream(), {
    httpMetadata: { contentType: file.type, cacheControl: 'public, max-age=31536000, immutable' },
  });

  return json({ url: `/api/img/${key}`, type: isImage ? 'image' : 'file', ext });
}

// 读取（公开）：/api/img/<key>
export async function serve(request, env) {
  if (!env.IMG_BUCKET) return error('存储未配置', 500);
  const url = new URL(request.url);
  const key = url.pathname.replace(/^\/api\/img\//, '');
  if (!key || key.includes('..')) return error('参数错误');

  const obj = await env.IMG_BUCKET.get(key);
  if (!obj) return error('文件不存在', 404);

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  // 非图片一律强制下载（Content-Disposition: attachment），杜绝 html/svg 等在浏览器执行
  const ct = obj.httpMetadata.contentType || '';
  if (!ct.startsWith('image/')) {
    const name = url.searchParams.get('name') || key.split('/').pop();
    headers.set('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
    headers.set('X-Content-Type-Options', 'nosniff');
  }
  // 支持 If-None-Match 协商缓存
  const inm = request.headers.get('if-none-match');
  if (inm && inm === obj.httpEtag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(obj.body, { status: 200, headers });
}
