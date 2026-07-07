#!/usr/bin/env python3
"""
YT2BILI Pipeline Runner
=======================
由 GitHub Actions 触发,负责从 Worker 拉取配置、下载 YouTube 视频、
转写/翻译字幕、上传到 B 站、回写结果。

环境变量:
  WORKER_URL      Worker 部署地址(如 https://yt2bili.xxx.workers.dev)
  PIPELINE_TOKEN  Pipeline Token(初始化时生成,可在控制台重置)

依赖:scripts/requirements.txt
外部工具:ffmpeg(由 workflow apt 安装)、yt-dlp(pip 包)
"""

import json
import os
import re
import shutil
import subprocess
import sys
import time
import tempfile
from pathlib import Path
from typing import Any

import requests

# ===== 配置 =====
WORKER_URL = os.environ.get("WORKER_URL", "").rstrip("/")
PIPELINE_TOKEN = os.environ.get("PIPELINE_TOKEN", "")
MAX_VIDEOS_PER_CHANNEL = 5  # 每个频道每次最多处理视频数


def log(event: str, status: str, **extra):
    """结构化日志,输出到 stdout,GitHub Actions 会捕获"""
    print(json.dumps({
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "event": event,
        "status": status,
        **extra,
    }), flush=True)


def worker_get(path: str) -> dict:
    """调用 Worker GET 接口(带 Bearer Token)"""
    url = f"{WORKER_URL}{path}"
    resp = requests.get(url, headers={"Authorization": f"Bearer {PIPELINE_TOKEN}"}, timeout=30)
    resp.raise_for_status()
    return resp.json()


def worker_post(path: str, body: dict) -> dict:
    """调用 Worker POST 接口(带 Bearer Token)"""
    url = f"{WORKER_URL}{path}"
    resp = requests.post(
        url,
        headers={
            "Authorization": f"Bearer {PIPELINE_TOKEN}",
            "Content-Type": "application/json",
        },
        json=body,
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


def run_cmd(cmd: list, cwd: str = None, timeout: int = None) -> subprocess.CompletedProcess:
    """运行命令并实时打印输出

    失败时拼装 stderr/stdout 到异常消息,超时清理子进程。
    """
    log("cmd", "start", cmd=" ".join(cmd), cwd=cwd, timeout=timeout)
    try:
        return subprocess.run(
            cmd, cwd=cwd, check=True, capture_output=True, text=True, timeout=timeout,
        )
    except subprocess.TimeoutExpired as e:
        log("cmd", "timeout", cmd=" ".join(cmd), timeout=timeout)
        raise RuntimeError(f"命令超时(>{timeout}s): {' '.join(cmd)}") from e
    except subprocess.CalledProcessError as e:
        stderr = (e.stderr or "").strip()
        stdout = (e.stdout or "").strip()
        tail = stderr[-500:] if stderr else (stdout[-500:] if stdout else str(e))
        raise RuntimeError(f"命令失败: {tail}") from e


def extract_audio(video_path: str, audio_path: str) -> None:
    """用 ffmpeg 提取音频"""
    run_cmd([
        "ffmpeg", "-y", "-i", video_path,
        "-vn", "-acodec", "libmp3lame", "-q:a", "4",
        audio_path,
    ], timeout=600)


def call_asr(asr_api: str, asr_key: str, audio_path: str) -> str:
    """调用 ASR API 转写音频,返回 SRT 字幕文本"""
    if not asr_api or not asr_key:
        raise RuntimeError("ASR API 未配置")
    # 读取音频文件
    with open(audio_path, "rb") as f:
        audio_data = f.read()
    # 假设 ASR API 接受 multipart 上传
    resp = requests.post(
        asr_api,
        headers={"Authorization": f"Bearer {asr_key}"},
        files={"file": (Path(audio_path).name, audio_data, "audio/mpeg")},
        data={"model": "mimo-asr", "response_format": "srt"},
        timeout=600,
    )
    if not resp.ok:
        raise RuntimeError(f"ASR API 返回 {resp.status_code}: {resp.text[:200]}")
    return resp.text


def call_translate(translate_api: str, translate_key: str, srt_content: str) -> str:
    """调用翻译 API 翻译 SRT 字幕"""
    if not translate_api or not translate_key:
        raise RuntimeError("翻译 API 未配置")
    prompt = (
        "请将以下 SRT 字幕文件翻译为简体中文,保持 SRT 格式不变(含序号、时间轴、换行)。"
        "只输出翻译后的 SRT 内容,不要任何解释:\n\n" + srt_content
    )
    resp = requests.post(
        translate_api,
        headers={
            "Authorization": f"Bearer {translate_key}",
            "Content-Type": "application/json",
        },
        json={
            "model": "gpt-3.5-turbo",
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.3,
        },
        timeout=300,
    )
    if not resp.ok:
        raise RuntimeError(f"翻译 API 返回 {resp.status_code}: {resp.text[:200]}")
    data = resp.json()
    return data["choices"][0]["message"]["content"]


def upload_to_bili(cfg: dict, video_path: str, cover_path: str, title: str,
                   desc: str, tags: list, tid: int, copyright_: int,
                   subtitle_files: dict, video_id: str = "") -> tuple:
    """
    上传视频到 B 站,返回 (bvid, subtitle_error)

    使用 bilibili-api-python 库。subtitle_error 在字幕/合集等非致命步骤
    失败时填入,供 Worker 决策是否补传字幕(视频本身已成功上传)。

    subtitle_files: {<lang_code>: "/path/to/xxx.srt", ...} 或 {}
        lang_code 必须是 B 站合法语言代码,如 "zh-Hans"、"en-US"。
    """
    from bilibili_api import video_uploader, Credential, sync

    credential = Credential(
        sessdata=cfg.get("bili_sessdata", ""),
        bili_jct=cfg.get("bili_jct", ""),
        buvid3=cfg.get("bili_buvid3", ""),
    )
    # 构建上传分 P
    page = video_uploader.VideoUploaderPage(
        path=video_path,
        title=title[:80],  # B 站标题限 80 字
        description=desc[:2000] if desc else "",
    )
    # 封面
    cover = cover_path if cover_path and Path(cover_path).exists() else ""
    # 元数据
    meta = {
        "title": title[:80],
        "desc": desc[:2000] if desc else "",
        "tid": tid or 122,  # 默认知识 - 科技科普
        "tag": tags[:10] if tags else [],  # B 站要求 list,最多 10 个
        "copyright": copyright_,  # 1=自制 2=转载
    }
    # 转载视频必须提供 source 字段,否则 B 站会拒
    if copyright_ == 2:
        meta["source"] = f"https://www.youtube.com/watch?v={video_id}" if video_id else "YouTube"
    uploader = video_uploader.VideoUploader(
        pages=[page],
        meta=meta,
        credential=credential,
        cover=cover,
    )
    # 同步上传
    result = sync(uploader.start())
    if not result or "bvid" not in result:
        raise RuntimeError(f"上传失败,返回: {result}")
    bvid = result["bvid"]
    log("bili_upload", "success", bvid=bvid, title=title[:50])

    # 上传字幕(如有)。字幕失败属于非致命错误:视频已成功上传,
    # 不应让本次整体回滚。记录错误返回给调用方写入回写结果。
    subtitle_error = ""
    if subtitle_files:
        try:
            from bilibili_api.video import Video
            video = Video(bvid=bvid, credential=credential)
            for lang, path in subtitle_files.items():
                if not path or not Path(path).exists():
                    continue
                with open(path, "r", encoding="utf-8") as f:
                    srt_content = f.read()
                # 转换 SRT 为 B 站字幕 JSON 格式
                subtitle_json = srt_to_bili_subtitle(srt_content)
                # 字幕上传是协程,需 sync() 包裹
                sync(video.upload_subtitle(
                    subtitle_json,
                    language=lang,
                    title="字幕",
                ))
                log("bili_subtitle", "success", bvid=bvid, lang=lang)
        except Exception as e:
            # 字幕失败提升到 error 级别,并写入回写结果让 Worker 决策补传
            log("bili_subtitle", "error", bvid=bvid, error=str(e)[:200])
            subtitle_error = str(e)[:200]
    return bvid, subtitle_error


def append_to_season(cfg: dict, bvid: str, season_id: str, section_id: str = None) -> None:
    """追加视频到 B 站合集

    直接用 requests 调用 B 站合集接口(不依赖 bilibili-api 私有模块)。
    参考 bilibili-API-collect: /x/creative/web/season/episode/add
    需要 Cookie 鉴权 + csrf(= bili_jct)。
    """
    sessdata = cfg.get("bili_sessdata", "")
    bili_jct = cfg.get("bili_jct", "")
    buvid3 = cfg.get("bili_buvid3", "")
    cookie = f"SESSDATA={sessdata}; bili_jct={bili_jct}; buvid3={buvid3}"
    payload = {
        "season_id": season_id,
        "bvid": bvid,
        "csrf": bili_jct,  # B 站写接口需 csrf = bili_jct
    }
    if section_id:
        payload["section_id"] = section_id
    resp = requests.post(
        "https://api.bilibili.com/x/creative/web/season/episode/add",
        headers={
            "Cookie": cookie,
            "User-Agent": "Mozilla/5.0",
            "Content-Type": "application/x-www-form-urlencoded",
            "Referer": "https://member.bilibili.com/",
        },
        data=payload,
        timeout=20,
    )
    try:
        data = resp.json()
    except Exception:
        raise RuntimeError(f"合集接口返回非 JSON: {resp.text[:200]}")
    code = data.get("code", -1)
    if code != 0:
        raise RuntimeError(f"合集追加失败 code={code}: {data.get('message', '')[:200]}")
    log("bili_season", "success", bvid=bvid, season_id=season_id)


def srt_to_bili_subtitle(srt_content: str) -> dict:
    """将 SRT 格式转换为 B 站字幕 JSON 格式"""
    body = []
    blocks = re.split(r"\n\s*\n", srt_content.strip())
    for block in blocks:
        lines = block.strip().split("\n")
        if len(lines) < 3:
            continue
        # 时间轴行: 00:00:01,000 --> 00:00:03,000
        time_match = re.match(
            r"(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})",
            lines[1],
        )
        if not time_match:
            continue
        h1, m1, s1, ms1, h2, m2, s2, ms2 = time_match.groups()
        start = int(h1) * 3600 + int(m1) * 60 + int(s1) + int(ms1) / 1000
        end = int(h2) * 3600 + int(m2) * 60 + int(s2) + int(ms2) / 1000
        text = "\n".join(lines[2:])
        body.append({"from": start, "to": end, "content": text})
    return({"body": body, "font_size": 0.4, "font_color": "#FFFFFF", "background_alpha": 0.5})


def _parse_srt_blocks(srt_content: str) -> list:
    """解析 SRT 为 [(index, time_line, text), ...] 列表"""
    parsed = []
    blocks = re.split(r"\n\s*\n", srt_content.strip())
    for block in blocks:
        lines = block.strip().split("\n")
        if len(lines) < 3:
            continue
        idx = lines[0].strip()
        time_line = lines[1].strip()
        text = "\n".join(lines[2:]).strip()
        parsed.append((idx, time_line, text))
    return parsed


def merge_srt_bilingual(translated_srt: str, original_srt: str) -> str:
    """合并翻译版与原版 SRT 为单文件双语字幕

    每条字幕的 content 拼接:中文 + 换行 + 原文。
    假设两份字幕条目数相同且顺序对齐(由同一份 ASR 输出产生)。
    采用翻译版的时间轴。
    """
    t_blocks = _parse_srt_blocks(translated_srt)
    o_blocks = _parse_srt_blocks(original_srt)
    out = []
    n = min(len(t_blocks), len(o_blocks))
    for i in range(n):
        idx, time_line, zh_text = t_blocks[i]
        _, _, orig_text = o_blocks[i]
        content = f"{zh_text}\n{orig_text}"
        out.append(f"{i + 1}\n{time_line}\n{content}")
    return "\n\n".join(out)


def detect_origin_lang(srt_content: str) -> str:
    """根据 ASR 输出文本简单判断语种,返回 B 站合法语言代码

    含大量 CJK 字符 -> zh-Hans,否则 -> en-US。无法判断时默认 zh-Hans。
    """
    if not srt_content:
        return "zh-Hans"
    # 取字幕正文部分(去掉序号和时间轴)
    text_only = re.sub(r"^\d+\s*$", "", srt_content, flags=re.MULTILINE)
    text_only = re.sub(
        r"\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[,.]\d{3}",
        "", text_only,
    )
    text_only = re.sub(r"\s+", "", text_only)
    if not text_only:
        return "zh-Hans"
    cjk_count = sum(1 for ch in text_only if "\u4e00" <= ch <= "\u9fff")
    if cjk_count / len(text_only) > 0.3:
        return "zh-Hans"
    return "en-US"


def process_video(video_id: str, cfg: dict, channel: dict = None) -> dict:
    """
    处理单个视频,返回结果 dict
    {
        "video_id": str,
        "status": "success" | "failed",
        "stage": str,  # 失败时填
        "message": str,  # 失败时填
        "bvid": str,  # 成功时填
        "title": str,
        "channel": str,
        "channel_id": str,
        "retryable": bool,
    }
    """
    work_dir = tempfile.mkdtemp(prefix=f"y2b_{video_id}_")
    result = {
        "video_id": video_id,
        "channel": channel.get("name", "") if channel else "",
        "channel_id": channel.get("channel_id", "") if channel else "",
        "title": video_id,
    }
    try:
        # 1. 下载视频
        log("download", "start", video_id=video_id)
        video_path = os.path.join(work_dir, f"{video_id}.mp4")
        cover_path = os.path.join(work_dir, f"{video_id}.jpg")
        ydl_opts = {
            "format": "bestvideo[height<=1080]+bestaudio/best[height<=1080]",
            "outtmpl": video_path,
            "writethumbnail": True,
            # 字幕一律走 ASR,不下载 YouTube 自动字幕
            "quiet": True,
            "no_warnings": True,
            "socket_timeout": 30,  # 单个 socket 操作超时
        }
        try:
            import yt_dlp
            # yt-dlp 无整体 timeout,用线程 + join 限制总耗时 1800s
            import threading
            download_exc = {"err": None}

            def _do_download():
                try:
                    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                        ydl.extract_info(
                            f"https://www.youtube.com/watch?v={video_id}", download=True,
                        )
                except Exception as e:  # noqa: BLE001
                    download_exc["err"] = e

            t = threading.Thread(target=_do_download, daemon=True)
            t.start()
            t.join(timeout=1800)
            if t.is_alive():
                # 线程仍在跑(超时),无法强制 kill yt-dlp 内部子进程,
                # 主流程放弃本次下载,等 Actions 层面处理
                raise RuntimeError("下载超时(>1800s)")
            if download_exc["err"]:
                raise download_exc["err"]
            # 重新拿 info(只读元数据,不下载)
            with yt_dlp.YoutubeDL({"quiet": True, "skip_download": True}) as ydl:
                info = ydl.extract_info(
                    f"https://www.youtube.com/watch?v={video_id}", download=False,
                ) or {}
            title = info.get("title", video_id)
            result["title"] = title
            # 封面重命名:支持 webp/jpg/png,统一转 jpg
            webp_path = video_path.replace(".mp4", ".webp")
            jpg_path = video_path.replace(".mp4", ".jpg")
            png_path = video_path.replace(".mp4", ".png")
            if os.path.exists(webp_path):
                run_cmd(["ffmpeg", "-y", "-i", webp_path, cover_path], timeout=60)
            elif os.path.exists(png_path):
                run_cmd(["ffmpeg", "-y", "-i", png_path, cover_path], timeout=60)
            elif os.path.exists(jpg_path):
                shutil.move(jpg_path, cover_path)
        except Exception as e:
            raise RuntimeError(f"下载失败: {e}")
        log("download", "success", video_id=video_id, title=title[:50])

        # 2. 提取音频
        log("extract_audio", "start", video_id=video_id)
        audio_path = os.path.join(work_dir, f"{video_id}.mp3")
        extract_audio(video_path, audio_path)
        log("extract_audio", "success", video_id=video_id)

        # 3. ASR 转写
        log("asr", "start", video_id=video_id)
        srt_translated = ""
        srt_original = ""
        try:
            srt_original = call_asr(
                cfg.get("asr_api", ""), cfg.get("asr_key", ""), audio_path,
            )
            log("asr", "success", video_id=video_id)
        except Exception as e:
            raise RuntimeError(f"ASR 转写失败: {e}")

        # 4. 翻译 / 字幕生成
        subtitle_mode = channel.get("subtitle_mode", "translated") if channel else "translated"
        subtitle_files = {}
        if subtitle_mode in ("translated", "both"):
            log("translate", "start", video_id=video_id)
            try:
                srt_translated = call_translate(
                    cfg.get("translate_api", ""), cfg.get("translate_key", ""),
                    srt_original,
                )
                zh_path = os.path.join(work_dir, f"{video_id}.zh.srt")
                with open(zh_path, "w", encoding="utf-8") as f:
                    f.write(srt_translated)
                log("translate", "success", video_id=video_id)
            except Exception as e:
                raise RuntimeError(f"翻译失败: {e}")

        if subtitle_mode == "both":
            # 真正的双语字幕:单文件,每条 content = 中文 + 换行 + 原文
            origin_lang = detect_origin_lang(srt_original)
            bilingual_path = os.path.join(work_dir, f"{video_id}.bilingual.srt")
            merged = merge_srt_bilingual(srt_translated, srt_original)
            with open(bilingual_path, "w", encoding="utf-8") as f:
                f.write(merged)
            # 双语用 zh-Hans(B 站不识别 ai-Zh)
            subtitle_files["zh-Hans"] = bilingual_path
        elif subtitle_mode == "translated":
            subtitle_files["zh-Hans"] = zh_path
        elif subtitle_mode == "original":
            origin_lang = detect_origin_lang(srt_original)
            origin_path = os.path.join(work_dir, f"{video_id}.origin.srt")
            with open(origin_path, "w", encoding="utf-8") as f:
                f.write(srt_original)
            # 用 B 站合法 code:zh-Hans(中文视频)或 en-US(英文视频)
            subtitle_files[origin_lang] = origin_path

        # 5. 上传到 B 站
        log("bili_upload", "start", video_id=video_id)
        tags = []
        if channel and channel.get("tags"):
            tags = [t.strip() for t in channel["tags"].split(",") if t.strip()]
        desc = f"原视频: https://www.youtube.com/watch?v={video_id}\n频道: {result['channel']}"
        bvid, subtitle_error = upload_to_bili(
            cfg=cfg,
            video_path=video_path,
            cover_path=cover_path,
            title=result["title"],
            desc=desc,
            tags=tags,
            tid=channel.get("tid", 122) if channel else 122,
            copyright_=channel.get("copyright", 2) if channel else 2,
            subtitle_files=subtitle_files,
            video_id=video_id,
        )
        result["bvid"] = bvid
        if subtitle_error:
            # 字幕失败但视频已上传成功:记录供 Worker 决策补传
            result["subtitle_error"] = subtitle_error

        # 6. 追加合集(若配置)
        if channel and channel.get("season_id"):
            try:
                append_to_season(cfg, bvid, channel["season_id"], channel.get("section_id"))
            except Exception as e:
                # 合集失败提升到 error,记录到 result 供 Worker 决策
                log("bili_season", "error", bvid=bvid, error=str(e)[:200])
                result["season_error"] = str(e)[:200]

        result["status"] = "success"
        result["stage"] = "completed"
        return result

    except Exception as e:
        msg = str(e)
        result["status"] = "failed"
        result["message"] = msg
        # 推断失败阶段
        if "下载" in msg:
            result["stage"] = "download"
        elif "ASR" in msg or "转写" in msg:
            result["stage"] = "asr"
        elif "翻译" in msg:
            result["stage"] = "translate"
        elif "上传" in msg:
            result["stage"] = "upload"
        else:
            result["stage"] = "unknown"
        # 网络错误可重试
        result["retryable"] = any(k in msg.lower() for k in [
            "timeout", "connection", "network", "429", "503", "502",
        ])
        log("process_video", "failed", video_id=video_id, stage=result["stage"],
            message=msg[:200], retryable=result["retryable"])
        return result
    finally:
        # 清理临时目录
        try:
            shutil.rmtree(work_dir, ignore_errors=True)
        except Exception:
            pass


def check_cookie_expiry(cfg: dict) -> bool:
    """
    检查 ac_time_value 是否即将过期(< 1 小时)。
    返回 True 表示 Cookie 即将过期,需要告警人工重登。

    注意:SESSDATA 续期必须走二次登录(QR Code),无法在 Runner 中自动完成。
    /x/web-interface/nav 仅返回用户信息,不下发新 SESSDATA,因此本函数
    不再做伪续期,只返回是否需要告警的标志。
    """
    ac_time = cfg.get("ac_time_value", "")
    if not ac_time:
        return False
    try:
        # ac_time_value 是时间戳(秒)
        expiry = int(ac_time)
        now = int(time.time())
        return (expiry - now) < 3600
    except (ValueError, TypeError):
        return False


def notify_cookie_expiry(cfg: dict) -> None:
    """Cookie 即将过期时,通过 Webhook 告警人工重登(不回写空 Cookie)。

    续期必须走二次登录(QR Code),Runner 无法自动完成。仅发告警,
    主流程继续使用现有 Cookie 处理(可能失败,失败由各步骤的 try/except 捕获)。
    """
    webhook = cfg.get("notify_webhook", "")
    if not webhook:
        log("cookie_expiry", "warning", message="Cookie 即将过期但未配置 notify_webhook")
        return
    ac_time = cfg.get("ac_time_value", "")
    try:
        remain = int(ac_time) - int(time.time())
        remain_str = f"{remain // 3600}h{(remain % 3600) // 60}m"
    except (ValueError, TypeError):
        remain_str = "未知"
    send_notify(
        webhook,
        "YT2BILI B 站 Cookie 即将过期,请人工重登",
        f"SESSDATA 剩余有效时间: {remain_str}\n"
        f"续期需在控制台重新扫码登录(二维码登录),Runner 无法自动续期。\n"
        f"Worker: {WORKER_URL}\n"
        f"时间: {time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime())} UTC",
    )
    log("cookie_expiry", "notified", remain=remain_str)


def send_notify(webhook_url: str, title: str, content: str) -> None:
    """发送失败通知到 Webhook(支持企业微信/钉钉/Server酱)"""
    if not webhook_url:
        return
    try:
        # Server 酱格式
        if "sctapi.ftqq.com" in webhook_url:
            requests.post(webhook_url, data={"title": title, "desp": content}, timeout=10)
        # 企业微信/钉钉格式(JSON)
        else:
            requests.post(
                webhook_url,
                json={"msgtype": "text", "text": {"content": f"{title}\n{content}"}},
                headers={"Content-Type": "application/json"},
                timeout=10,
            )
        log("notify", "success", webhook=webhook_url[:50])
    except Exception as e:
        log("notify", "warning", error=str(e)[:200])


def writeback_single(result: dict) -> bool:
    """单条回写处理结果到 Worker(增量),失败重试 2 次。

    返回 True 表示回写成功。增量回写避免批量回写失败导致已上传视频
    下次被重复处理。
    """
    for attempt in range(3):  # 1 次正常 + 2 次重试
        try:
            worker_post("/api/pipeline/processed", {"results": [result]})
            return True
        except Exception as e:
            log("writeback_single", "retry",
                video_id=result.get("video_id", ""), attempt=attempt + 1,
                error=str(e)[:200])
            if attempt < 2:
                time.sleep(2 * (attempt + 1))
    log("writeback_single", "failed",
        video_id=result.get("video_id", ""),
        message="单条回写 3 次均失败,Worker 侧需对账")
    return False


def main():
    system_status = "normal"
    error_summary = ""

    if not WORKER_URL or not PIPELINE_TOKEN:
        print("::error::WORKER_URL 或 PIPELINE_TOKEN 环境变量未配置", file=sys.stderr)
        system_status = "error"
        error_summary = "WORKER_URL 或 PIPELINE_TOKEN 未配置"
        _writeback_final_status(system_status, error_summary)
        sys.exit(1)

    log("pipeline_start", "start", worker_url=WORKER_URL)

    try:
        # 1. 拉取全部配置(字段访问加保护,Worker 返回异常不崩)
        try:
            data = worker_get("/api/pipeline/config")
        except Exception as e:
            log("pipeline_pull", "failed", error=str(e)[:200])
            system_status = "error"
            error_summary = f"拉取配置失败: {str(e)[:200]}"
            raise

        cfg = data.get("config", {}) or {}
        channels = data.get("channels", []) or []
        manual_queue = data.get("manual_queue", []) or []
        processed = data.get("processed", {}) or {}  # {video_id: {...}}

        log("pipeline_pull", "success",
            channels=len(channels), manual_queue=len(manual_queue),
            processed=len(processed))

        # 2. Cookie 过期检查(仅告警,不回写空 Cookie)
        if check_cookie_expiry(cfg):
            log("cookie_check", "need_notify")
            notify_cookie_expiry(cfg)

        # 3. 收集待处理视频
        results = []
        failed_results = []  # 单条回写失败的视频,末尾再批量重试一次

        # 3.1 启用频道的最新视频
        for channel in channels:
            if not channel.get("enabled", True):
                continue
            try:
                log("channel_scan", "start", channel=channel.get("name", ""))
                import yt_dlp
                with yt_dlp.YoutubeDL({"quiet": True, "extract_flat": True}) as ydl:
                    playlist = ydl.extract_info(
                        f"https://www.youtube.com/feeds/videos.xml?channel_id={channel.get('channel_id', '')}",
                        download=False,
                    ) or {}
                # 取最新 N 条
                entries = (playlist.get("entries", []) or [])[:MAX_VIDEOS_PER_CHANNEL]
                for entry in entries:
                    video_id = entry.get("id", "") if isinstance(entry, dict) else ""
                    if not video_id or video_id in processed:
                        continue
                    log("process", "start", video_id=video_id,
                        channel=channel.get("name", ""))
                    result = process_video(video_id, cfg, channel)
                    results.append(result)
                    # 增量回写:成功后立即单条回写,避免批量回写失败丢数据
                    if not writeback_single(result):
                        failed_results.append(result)
                    if result["status"] == "success":
                        processed[video_id] = result
            except Exception as e:
                log("channel_scan", "failed",
                    channel=channel.get("name", ""), error=str(e)[:200])

        # 3.2 处理 manual_queue 中的视频
        for item in manual_queue:
            if not isinstance(item, dict):
                continue
            video_id = item.get("video_id")
            if not video_id:
                continue
            # manual_queue 项可能在频道处理中已被处理
            if video_id in processed:
                continue
            log("process", "start", video_id=video_id, source="manual_queue")
            # 找到对应的频道配置
            channel_config = None
            config_id = item.get("channel_config_id")
            if config_id:
                channel_config = next(
                    (c for c in channels if c.get("id") == config_id), None,
                )
            result = process_video(video_id, cfg, channel_config)
            results.append(result)
            if not writeback_single(result):
                failed_results.append(result)
            if result["status"] == "success":
                processed[video_id] = result

        # 4. 单条回写失败项末尾再批量回写一次(尽量不丢)
        if failed_results:
            try:
                worker_post("/api/pipeline/processed", {"results": failed_results})
                log("writeback", "success", batched=len(failed_results))
            except Exception as e:
                log("writeback", "failed", error=str(e)[:200],
                    batched=len(failed_results))

        # 5. 失败通知:本次运行内失败率统计(Runner 无状态,删除跨运行"连续"概念)
        total = len(results)
        success_count = sum(1 for r in results if r["status"] == "success")
        fail_count = total - success_count
        notify_webhook = cfg.get("notify_webhook", "")
        if notify_webhook and total >= 2 and fail_count / total >= 0.5:
            send_notify(
                notify_webhook,
                "YT2BILI 流水线失败率告警",
                f"本次运行处理 {total} 个视频,失败 {fail_count} 个"
                f"(失败率 {fail_count * 100 // total}%)。\n"
                f"请检查 Cookie / ASR / 翻译 API 配置。\n"
                f"Worker: {WORKER_URL}\n"
                f"时间: {time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime())} UTC",
            )

        # 汇总
        if total == 0:
            system_status = "normal"
        elif fail_count == 0:
            system_status = "normal"
        elif success_count == 0:
            system_status = "error"
            error_summary = f"全部 {total} 个视频失败"
        else:
            system_status = "degraded"
            error_summary = f"{fail_count}/{total} 个视频失败"

        log("pipeline_done", "success" if fail_count == 0 else "partial",
            total=total, success=success_count, failed=fail_count)

    except Exception as e:
        # 任何未预期异常都走到这里(注意上面 raise 也会到这)
        if not error_summary:
            error_summary = f"未预期异常: {str(e)[:200]}"
        if system_status == "normal":
            system_status = "error"
        log("pipeline", "error", error=str(e)[:200])

    finally:
        # 无论成功失败都回写最终状态,Worker 才能感知本次运行结果
        _writeback_final_status(system_status, error_summary)


def _writeback_final_status(system_status: str, error_summary: str) -> None:
    """回写最终运行状态到 Worker(无论成功失败)"""
    try:
        worker_post("/api/pipeline/status", {
            "last_run_at": int(time.time() * 1000),
            "system_status": system_status,
            "error_summary": error_summary,
        })
    except Exception as e:
        log("status_writeback", "failed", error=str(e)[:200])


if __name__ == "__main__":
    main()
