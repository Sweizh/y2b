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
NOTIFY_CONSECUTIVE_FAIL_THRESHOLD = 3  # 触发失败通知的连续失败次数阈值


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


def run_cmd(cmd: list, cwd: str = None) -> subprocess.CompletedProcess:
    """运行命令并实时打印输出"""
    log("cmd", "start", cmd=" ".join(cmd), cwd=cwd)
    return subprocess.run(cmd, cwd=cwd, check=True, capture_output=True, text=True)


def extract_audio(video_path: str, audio_path: str) -> None:
    """用 ffmpeg 提取音频"""
    run_cmd([
        "ffmpeg", "-y", "-i", video_path,
        "-vn", "-acodec", "libmp3lame", "-q:a", "4",
        audio_path,
    ])


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
                   subtitle_files: dict) -> str:
    """
    上传视频到 B 站,返回 BV 号
    使用 bilibili-api-python 库

    subtitle_files: {"zh-CN": "/path/to/zh.srt", "origin": "/path/to/origin.srt"} 或 {}
    """
    from bilibili_api import video_uploader, Credential, sync

    credential = Credential(
        sessdata=cfg["bili_sessdata"],
        bili_jct=cfg["bili_jct"],
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
        "tag": ",".join(tags[:10]) if tags else "",
        "copyright": copyright_,  # 1=自制 2=转载
    }
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
    # 上传字幕(如有)
    if subtitle_files:
        try:
            from bilibili_api import subtitle
            video = video_uploader.Video(bvid=bvid, credential=credential)
            for lang, path in subtitle_files.items():
                if not path or not Path(path).exists():
                    continue
                with open(path, "r", encoding="utf-8") as f:
                    srt_content = f.read()
                # 转换 SRT 为 B 站字幕 JSON 格式
                subtitle_json = srt_to_bili_subtitle(srt_content)
                subtitle.upload_subtitle(
                    video=video,
                    subtitle=subtitle_json,
                    language=lang,
                    title="字幕",
                )
                log("bili_subtitle", "success", bvid=bvid, lang=lang)
        except Exception as e:
            log("bili_subtitle", "warning", bvid=bvid, error=str(e)[:200])
    return bvid


def append_to_season(cfg: dict, bvid: str, season_id: str, section_id: str = None) -> None:
    """追加视频到 B 站合集"""
    try:
        from bilibili_api import Credential, sync
        from bilibili_api.utils.network import Api
        credential = Credential(
            sessdata=cfg["bili_sessdata"],
            bili_jct=cfg["bili_jct"],
            buvid3=cfg.get("bili_buvid3", ""),
        )
        # 调用合集追加接口
        # 参考 bilibili-API-collect: /x/creative/web/season/episode/add
        api = Api(
            url="https://api.bilibili.com/x/creative/web/season/episode/add",
            method="POST",
            credential=credential,
        )
        params = {
            "season_id": season_id,
            "bvid": bvid,
        }
        if section_id:
            params["section_id"] = section_id
        sync(api.update_params(**params).result)
        log("bili_season", "success", bvid=bvid, season_id=season_id)
    except Exception as e:
        log("bili_season", "warning", bvid=bvid, season_id=season_id, error=str(e)[:200])


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
            "writeautomaticsub": True,
            "subtitleslangs": ["en", "zh-Hans"],
            "subtitlesformat": "srt",
            "quiet": True,
            "no_warnings": True,
        }
        try:
            import yt_dlp
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=True)
                title = info.get("title", video_id)
                result["title"] = title
                # 封面重命名
                if os.path.exists(video_path.replace(".mp4", ".webp")):
                    run_cmd(["ffmpeg", "-y", "-i",
                             video_path.replace(".mp4", ".webp"), cover_path])
                elif os.path.exists(video_path.replace(".mp4", ".jpg")):
                    shutil.move(video_path.replace(".mp4", ".jpg"), cover_path)
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
            srt_original = call_asr(cfg["asr_api"], cfg["asr_key"], audio_path)
            log("asr", "success", video_id=video_id)
        except Exception as e:
            raise RuntimeError(f"ASR 转写失败: {e}")

        # 4. 翻译
        subtitle_mode = channel.get("subtitle_mode", "translated") if channel else "translated"
        subtitle_files = {}
        if subtitle_mode in ("translated", "both"):
            log("translate", "start", video_id=video_id)
            try:
                srt_translated = call_translate(
                    cfg["translate_api"], cfg["translate_key"], srt_original
                )
                zh_path = os.path.join(work_dir, f"{video_id}.zh.srt")
                with open(zh_path, "w", encoding="utf-8") as f:
                    f.write(srt_translated)
                subtitle_files["zh-CN"] = zh_path
                log("translate", "success", video_id=video_id)
            except Exception as e:
                raise RuntimeError(f"翻译失败: {e}")
        if subtitle_mode in ("original", "both"):
            origin_path = os.path.join(work_dir, f"{video_id}.origin.srt")
            with open(origin_path, "w", encoding="utf-8") as f:
                f.write(srt_original)
            subtitle_files["ai-Zh"] = origin_path  # 原语言标记

        # 5. 上传到 B 站
        log("bili_upload", "start", video_id=video_id)
        tags = []
        if channel and channel.get("tags"):
            tags = [t.strip() for t in channel["tags"].split(",") if t.strip()]
        desc = f"原视频: https://www.youtube.com/watch?v={video_id}\n频道: {result['channel']}"
        bvid = upload_to_bili(
            cfg=cfg,
            video_path=video_path,
            cover_path=cover_path,
            title=result["title"],
            desc=desc,
            tags=tags,
            tid=channel.get("tid", 122) if channel else 122,
            copyright_=channel.get("copyright", 2) if channel else 2,
            subtitle_files=subtitle_files,
        )
        result["bvid"] = bvid

        # 6. 追加合集(若配置)
        if channel and channel.get("season_id"):
            try:
                append_to_season(cfg, bvid, channel["season_id"], channel.get("section_id"))
            except Exception as e:
                log("bili_season", "warning", bvid=bvid, error=str(e)[:200])

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
    检查 ac_time_value 是否即将过期(< 1 小时)
    返回 True 表示需要续期
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


def refresh_bili_cookie(cfg: dict) -> dict:
    """
    用现有凭证调用 B 站刷新接口获取新 Cookie
    参考 bilibili-API-collect: /x/web-interface/nav 验证 + 刷新
    """
    log("cookie_refresh", "start")
    try:
        # 调用 nav 接口验证当前 Cookie 并获取新 SESSDATA
        # B 站访问 nav 接口会自动续期 SESSDATA,通过 Set-Cookie 返回
        resp = requests.get(
            "https://api.bilibili.com/x/web-interface/nav",
            headers={
                "Cookie": f"SESSDATA={cfg['bili_sessdata']}; bili_jct={cfg['bili_jct']}; buvid3={cfg.get('bili_buvid3', '')}",
                "User-Agent": "Mozilla/5.0",
            },
            timeout=10,
        )
        set_cookie = resp.headers.get("Set-Cookie", "")
        new_sessdata = cfg["bili_sessdata"]
        new_jct = cfg["bili_jct"]
        # 解析新 Cookie
        sess_match = re.search(r"SESSDATA=([^;]+)", set_cookie)
        if sess_match:
            new_sessdata = sess_match.group(1)
        jct_match = re.search(r"bili_jct=([^;]+)", set_cookie)
        if jct_match:
            new_jct = jct_match.group(1)
        log("cookie_refresh", "success",
            sessdata_changed=(new_sessdata != cfg["bili_sessdata"]))
        return {"bili_sessdata": new_sessdata, "bili_jct": new_jct}
    except Exception as e:
        log("cookie_refresh", "failed", error=str(e)[:200])
        return {}


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


def main():
    if not WORKER_URL or not PIPELINE_TOKEN:
        print("::error::WORKER_URL 或 PIPELINE_TOKEN 环境变量未配置", file=sys.stderr)
        sys.exit(1)

    log("pipeline_start", "start", worker_url=WORKER_URL)

    # 1. 拉取全部配置
    try:
        data = worker_get("/api/pipeline/config")
    except Exception as e:
        log("pipeline_pull", "failed", error=str(e)[:200])
        sys.exit(1)

    cfg = data["config"]
    channels = data["channels"]
    manual_queue = data["manual_queue"]
    processed = data["processed"]  # {video_id: {...}}

    log("pipeline_pull", "success",
        channels=len(channels), manual_queue=len(manual_queue),
        processed=len(processed))

    # 2. Cookie 续期检查
    if check_cookie_expiry(cfg):
        log("cookie_check", "need_refresh")
        new_cookies = refresh_bili_cookie(cfg)
        if new_cookies:
            try:
                worker_post("/api/pipeline/cookies", new_cookies)
                log("cookie_writeback", "success")
            except Exception as e:
                log("cookie_writeback", "failed", error=str(e)[:200])

    # 3. 收集待处理视频
    results = []
    consecutive_fails = 0

    # 3.1 启用频道的最新视频
    for channel in channels:
        if not channel.get("enabled", True):
            continue
        try:
            log("channel_scan", "start", channel=channel["name"])
            import yt_dlp
            with yt_dlp.YoutubeDL({"quiet": True, "extract_flat": True}) as ydl:
                playlist = ydl.extract_info(
                    f"https://www.youtube.com/feeds/videos.xml?channel_id={channel['channel_id']}",
                    download=False,
                )
            # 取最新 N 条
            entries = (playlist.get("entries", []) or [])[:MAX_VIDEOS_PER_CHANNEL]
            for entry in entries:
                video_id = entry.get("id", "")
                if not video_id or video_id in processed:
                    continue
                log("process", "start", video_id=video_id, channel=channel["name"])
                result = process_video(video_id, cfg, channel)
                results.append(result)
                if result["status"] == "success":
                    consecutive_fails = 0
                    processed[video_id] = result
                else:
                    consecutive_fails += 1
        except Exception as e:
            log("channel_scan", "failed", channel=channel["name"], error=str(e)[:200])

    # 3.2 处理 manual_queue 中的视频
    for item in manual_queue:
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
            channel_config = next((c for c in channels if c.get("id") == config_id), None)
        result = process_video(video_id, cfg, channel_config)
        results.append(result)
        if result["status"] == "success":
            consecutive_fails = 0
            processed[video_id] = result
        else:
            consecutive_fails += 1

    # 4. 回写处理结果到 Worker
    try:
        writeback = worker_post("/api/pipeline/processed", {"results": results})
        log("writeback", "success", **writeback)
    except Exception as e:
        log("writeback", "failed", error=str(e)[:200])

    # 5. 失败通知
    notify_webhook = cfg.get("notify_webhook", "")
    if notify_webhook and consecutive_fails >= NOTIFY_CONSECUTIVE_FAIL_THRESHOLD:
        send_notify(
            notify_webhook,
            "YT2BILI 流水线连续失败告警",
            f"连续失败 {consecutive_fails} 次,请检查 Cookie 或 API 配置。\n"
            f"Worker: {WORKER_URL}\n"
            f"时间: {time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime())} UTC",
        )

    # 6. 回写最终状态
    try:
        worker_post("/api/pipeline/status", {
            "last_run_at": int(time.time() * 1000),
            "system_status": "normal" if consecutive_fails == 0 else "degraded",
        })
    except Exception as e:
        log("status_writeback", "failed", error=str(e)[:200])

    # 汇总
    success_count = sum(1 for r in results if r["status"] == "success")
    fail_count = len(results) - success_count
    log("pipeline_done", "success" if fail_count == 0 else "partial",
        total=len(results), success=success_count, failed=fail_count)


if __name__ == "__main__":
    main()
