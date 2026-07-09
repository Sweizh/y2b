// KV 读写封装 + 配置/频道/状态/队列/去重表的统一访问层

import { encrypt, decrypt } from './crypto';

export interface Config {
  admin_password?: string;          // bcrypt 哈希
  pipeline_token?: string;         // 32 字节随机 token
  initialized?: boolean;
  // B 站凭证
  bili_sessdata?: string;
  bili_jct?: string;
  bili_buvid3?: string;
  ac_time_value?: string;
  bili_login_at?: number;          // 上次扫码登录时间戳(ms),供前端展示
  bili_uname?: string;             // 上次扫码登录的账号名,供前端展示
  // YouTube API Key 模式(旧)
  yt_api_key?: string;
  // YouTube OAuth 模式(新,优先于 yt_api_key)
  yt_client_id?: string;           // Google OAuth 客户端 ID
  yt_client_secret?: string;       // Google OAuth 客户端密钥(加密存储)
  yt_redirect_uri?: string;        // OAuth 回调地址(如 https://xxx.workers.dev/api/youtube/oauth/callback)
  yt_access_token?: string;        // OAuth access token(加密存储)
  yt_refresh_token?: string;       // OAuth refresh token(加密存储,长期有效)
  yt_token_expires_at?: number;    // access token 过期时间戳(ms)
  yt_user_email?: string;          // OAuth 登录的 Google 账号 email(非敏感,展示用)
  yt_user_name?: string;           // OAuth 登录的账号显示名(非敏感,展示用)
  yt_user_avatar?: string;         // OAuth 登录的账号头像 URL(非敏感)
  yt_login_at?: number;            // 上次 OAuth 登录时间戳(ms)
  // yt-dlp 下载用 cookies(Netscape cookies.txt 格式,加密存储)
  yt_cookies?: string;
  // GitHub
  gh_token?: string;
  gh_repo?: string;
  // ASR
  asr_api?: string;
  asr_key?: string;
  asr_model?: string;          // ASR 模型名(如 mimo-v2.5-asr),留空用 Runner 默认值
  // VideoCaptioner 集成(ASR 后端 / 字幕处理)
  asr_provider?: string;              // ASR 后端: bijian(默认) | jianying | whisper-api
  subtitle_translator?: string;       // 字幕翻译服务: llm(默认) | bing | google
  subtitle_target_language?: string;  // 目标语言 BCP 47,默认 zh-Hans
  subtitle_optimize?: boolean;        // 是否 ASR 纠错优化,默认 true
  subtitle_split?: boolean;          // 是否语义断句,默认 true
  subtitle_reflect?: boolean;        // 是否反思式翻译,默认 false
  subtitle_prompt?: string;          // 文稿提示(术语表/参考文稿)
  // 翻译
  translate_api?: string;
  translate_key?: string;
  translate_model?: string;   // 翻译模型名(如 gpt-3.5-turbo / auto),留空用 Runner 默认值
  // 通知
  notify_webhook?: string;
  // 标题翻译模板(全局,支持变量 {channel} 频道名、{title} 翻译后标题)
  // 留空则不翻译不套模板,沿用 yt-dlp 原始标题
  title_template?: string;
  // 翻译开关与提示词(全局)
  translate_subtitle_enabled?: boolean;   // 字幕翻译总开关,默认 true
  translate_title_enabled?: boolean;       // 标题与简介翻译开关,默认 false
  translate_prompt?: string;               // 自然语言自定义翻译要求,留空用默认 prompt
}

export interface Channel {
  id: string;
  channel_id: string;
  name: string;
  season_id?: string;
  section_id?: string;
  tid?: number;
  tags?: string;
  copyright?: 1 | 2;       // 1=自制 2=转载
  subtitle_mode?: 'translated' | 'original' | 'both' | 'none';
  enabled?: boolean;
  since?: string;                          // 起始时间过滤(YYYY-MM-DD),仅搬运该日期之后发布的视频
  created_at?: number;
}

export interface ProcessedItem {
  video_id: string;
  bvid?: string;
  title?: string;
  channel?: string;
  channel_id?: string;
  status: 'success' | 'failed';
  stage?: string;            // 中断阶段
  message?: string;          // 失败原因
  processed_at: number;
  // 视频已上传但字幕/合集追加失败时的非致命错误(供后续补传决策)
  subtitle_error?: string;   // 字幕上传失败原因(视频已成功上传)
  season_error?: string;    // 合集追加失败原因(视频已成功上传)
}

export interface ManualQueueItem {
  video_id: string;
  url?: string;
  title?: string;
  channel_config_id?: string;
  season_id?: string;        // 手动指定 B 站合集(优先于 channel_config.season_id)
  section_id?: string;       // 合集小节 ID
  added_at: number;
  status: 'pending' | 'processing' | 'retry';
  retry_count?: number;
  last_error?: string;
  last_error_at?: number;  // 失败时间戳,供拉取侧做冷却判断
}

export interface StatusRecord {
  last_run_at?: number;
  total_processed?: number;
  recent_records?: Array<{
    channel: string;
    video_title: string;
    status: 'success' | 'failed';
    stage?: string;
    message?: string;
    processed_at: number;
  }>;
  system_status?: 'normal' | 'degraded' | 'error';
  cookie_status?: 'ok' | 'expired' | 'expiring' | 'unknown';
  // Runner 上报的失败摘要(本次运行的失败原因概述,如 "全部 3 个视频失败")
  error_summary?: string;
}

const KEYS = {
  config: 'config',
  channels: 'channels',
  manual_queue: 'manual_queue',
  processed: 'processed',
  status: 'status',
} as const;

// 容量上限常量(KV value 上限 25MB,这里留足余量)
const MAX_PROCESSED = 500;  // 去重表:保留最近 500 条(超出的老视频可能被重新处理)
const MAX_STATUS_RECORDS = 100;  // 状态记录:保留最近 100 条

// 敏感字段列表：存储时加密，读取时解密
const SENSITIVE_FIELDS: (keyof Config)[] = [
  'bili_sessdata', 'bili_jct', 'bili_buvid3', 'ac_time_value',
  'yt_api_key', 'yt_cookies',
  'yt_client_secret', 'yt_access_token', 'yt_refresh_token',  // OAuth 凭证(加密)
  'gh_token', 'asr_key', 'translate_key',
];

// 脱敏字段列表：GET /api/config 返回时打码
// 注意:pipeline_token 不在此列表,而是在 maskConfig 中直接删除
const MASK_FIELDS: (keyof Config)[] = [
  'admin_password', 'bili_sessdata', 'bili_jct', 'bili_buvid3', 'ac_time_value',
  'yt_api_key', 'yt_cookies',
  'yt_client_secret', 'yt_access_token', 'yt_refresh_token',
  'gh_token', 'asr_key', 'translate_key',
];

// 统一脱敏:固定返回 ****,不泄露明文片段(长度提示供前端判断是否已设置)
function mask(value: string): string {
  if (!value) return '';
  return '****(已设置,' + value.length + '字符)';
}

export async function getRawConfig(kv: KVNamespace, encryptionKey: string): Promise<Config> {
  const raw = await kv.get(KEYS.config);
  if (!raw) return {};  // 新装系统:无配置,合法
  try {
    const cfg = JSON.parse(raw) as Config;
    // 解密敏感字段
    const result: any = { ...cfg };
    for (const field of SENSITIVE_FIELDS) {
      if (result[field]) {
        result[field] = await decrypt(result[field] as string, encryptionKey);
      }
    }
    return result as Config;
  } catch (e) {
    // 数据损坏或解密失败(如 ENCRYPTION_KEY 变更)
    // 关键:不能返回空对象!否则 initialized 为 falsy,init 路由会允许重新初始化,
    // 攻击者可重新设置 admin_password 接管系统(密码重置即等于账户接管)
    // 这里强制返回 initialized=true,阻断重置路径,使管理员必须先手动清理 KV
    console.error('[kv] config 数据损坏或解密失败,拒绝重新初始化:', e instanceof Error ? e.message : String(e));
    return { initialized: true };
  }
}

export async function putConfig(kv: KVNamespace, cfg: Config, encryptionKey: string): Promise<void> {
  const stored: any = { ...cfg };
  // 加密敏感字段
  for (const field of SENSITIVE_FIELDS) {
    if (stored[field]) {
      stored[field] = await encrypt(stored[field] as string, encryptionKey);
    }
  }
  await kv.put(KEYS.config, JSON.stringify(stored));
}

// 返回给前端的脱敏版本
export function maskConfig(cfg: Config): Config {
  const masked: any = { ...cfg };
  for (const field of MASK_FIELDS) {
    if (masked[field]) {
      masked[field] = mask(masked[field] as string);
    }
  }
  // admin_password / pipeline_token 完全不返回给前端
  // pipeline_token 是 Runner 鉴权凭证,泄露可冒充 Runner 写回任意数据
  delete masked.admin_password;
  delete masked.pipeline_token;
  return masked as Config;
}

export async function getChannels(kv: KVNamespace): Promise<Channel[]> {
  const raw = await kv.get(KEYS.channels);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as Channel[];
  } catch (e) {
    console.error('[kv] channels 数据损坏,返回空列表:', e instanceof Error ? e.message : String(e));
    return [];
  }
}

export async function putChannels(kv: KVNamespace, channels: Channel[]): Promise<void> {
  await kv.put(KEYS.channels, JSON.stringify(channels));
}

export async function getManualQueue(kv: KVNamespace): Promise<ManualQueueItem[]> {
  const raw = await kv.get(KEYS.manual_queue);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as ManualQueueItem[];
  } catch (e) {
    console.error('[kv] manual_queue 数据损坏,返回空列表:', e instanceof Error ? e.message : String(e));
    return [];
  }
}

export async function putManualQueue(kv: KVNamespace, queue: ManualQueueItem[]): Promise<void> {
  await kv.put(KEYS.manual_queue, JSON.stringify(queue));
}

export async function getProcessed(kv: KVNamespace): Promise<Record<string, ProcessedItem>> {
  const raw = await kv.get(KEYS.processed);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, ProcessedItem>;
  } catch (e) {
    console.error('[kv] processed 数据损坏,返回空表(已处理视频可能被重复处理):', e instanceof Error ? e.message : String(e));
    return {};
  }
}

export async function putProcessed(kv: KVNamespace, processed: Record<string, ProcessedItem>): Promise<void> {
  // 裁剪:保留最近 MAX_PROCESSED 条
  // 注意:超出的老视频会从去重表中消失,下次被频道扫描拉到时可能被重新处理
  const entries = Object.entries(processed);
  if (entries.length > MAX_PROCESSED) {
    entries.sort((a, b) => (b[1].processed_at || 0) - (a[1].processed_at || 0));
    const trimmed = Object.fromEntries(entries.slice(0, MAX_PROCESSED));
    console.warn('[kv] processed 超出上限,截断 ' + (entries.length - MAX_PROCESSED) + ' 条(老视频可能被重新处理)');
    await kv.put(KEYS.processed, JSON.stringify(trimmed));
  } else {
    await kv.put(KEYS.processed, JSON.stringify(processed));
  }
}

export async function getStatus(kv: KVNamespace): Promise<StatusRecord> {
  const raw = await kv.get(KEYS.status);
  if (!raw) return { system_status: 'normal', recent_records: [] };
  try {
    return JSON.parse(raw) as StatusRecord;
  } catch (e) {
    console.error('[kv] status 数据损坏,返回默认状态:', e instanceof Error ? e.message : String(e));
    return { system_status: 'normal', recent_records: [] };
  }
}

export async function putStatus(kv: KVNamespace, status: StatusRecord): Promise<void> {
  // 裁剪:保留最近 MAX_STATUS_RECORDS 条
  if (status.recent_records && status.recent_records.length > MAX_STATUS_RECORDS) {
    status.recent_records = status.recent_records
      .sort((a, b) => (b.processed_at || 0) - (a.processed_at || 0))
      .slice(0, MAX_STATUS_RECORDS);
  }
  await kv.put(KEYS.status, JSON.stringify(status));
}

export function generateId(): string {
  return crypto.randomUUID();
}

export function generateToken(): string {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}
