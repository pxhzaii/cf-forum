import { json, error, getLoginUser } from '../util.js';

// 允许的图片 MIME 类型白名单
const ALLOWED_TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};
const MAX_SIZE = 5 * 1024 * 1024; // 5MB

// 上传图片：multipart/form-data，字段名 file；存入 R2，返回 /api/img/<key>
export async function upload(request, env) {
  const user = await getLoginUser(request, env);
  if (!user) return error('未登录', 401);
  if (!env.IMG_BUCKET) return error('图片存储未配置', 500);

  let form;
  try { form = await request.formData(); } catch { return error('请求格式错误'); }
  const file = form.get('file');
  if (!file || typeof file === 'string') return error('请选择图片文件');

  const ext = ALLOWED_TYPES[file.type];
  if (!ext) return error('仅支持 png/jpg/gif/webp 图片');
  if (file.size > MAX_SIZE) return error('图片不能超过 5MB');

  // key: img/<uid>/<时间戳><随机>.<ext>
  const key = `img/${user.id}/${Date.now()}${Math.floor(Math.random() * 10000)}.${ext}`;
  await env.IMG_BUCKET.put(key, file.stream(), {
    httpMetadata: { contentType: file.type, cacheControl: 'public, max-age=31536000, immutable' },
  });

  return json({ url: `/api/img/${key}` });
}

// 读取图片：/api/img/img/<uid>/<file>，无需登录（帖子内图片公开可读）
export async function serve(request, env) {
  if (!env.IMG_BUCKET) return error('图片存储未配置', 500);
  const url = new URL(request.url);
  const key = url.pathname.replace(/^\/api\/img\//, '');
  if (!key || key.includes('..')) return error('参数错误');

  const obj = await env.IMG_BUCKET.get(key);
  if (!obj) return error('图片不存在', 404);

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  // 支持 If-None-Match 协商缓存
  const inm = request.headers.get('if-none-match');
  if (inm && inm === obj.httpEtag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(obj.body, { status: 200, headers });
}