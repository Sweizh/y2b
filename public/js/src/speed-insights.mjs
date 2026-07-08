/**
 * speed-insights.mjs — Vercel Speed Insights 集成
 * 
 * 为应用注入 Vercel Speed Insights 跟踪脚本
 */
import { injectSpeedInsights } from '@vercel/speed-insights';

// 初始化 Speed Insights
injectSpeedInsights();
