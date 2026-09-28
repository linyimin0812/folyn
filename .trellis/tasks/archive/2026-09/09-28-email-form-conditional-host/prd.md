# email 表单：已知域名隐藏 IMAP 服务器/端口字段

## Goal

CollectorsSettings 的 email 账户表单里，IMAP 服务器/端口字段对已知域名（qq/163/gmail 等在扩展 IMAP_HOSTS 表内的）是噪音 —— 采集端会自动推断。仅当域名未知（需要手填）或用户已手填 host 时才显示这两个字段。

## Requirements

* 账户的 username 域名在已知供应商列表（镜像扩展 `IMAP_HOSTS` 的键集）→ 隐藏「IMAP 服务器」「端口」字段
* 域名未知（不在表内，推断只是 `imap.<domain>` 猜测）→ 显示
* 用户已手动填了 host（值非空）→ 始终显示（不吞已有输入）
* 采集端逻辑不变（隐藏 ≠ 禁用；host 留空仍走推断）

## Acceptance Criteria

* [x] 填 `xxx@qq.com` → 表单无 host/port 字段；换未知域名 → 字段出现
* [x] 已填 host 的账户字段不消失
* [x] desktop tsc 绿

## Technical Approach

* `CollectorsSettings.tsx` email 分支加 `KNOWN_IMAP_DOMAINS`（镜像 `extensions/email-collector/src/emailEvents.ts` IMAP_HOSTS 键，ponytail 注释标明镜像关系）
* 渲染条件：`showHost = String(acc.host ?? '') !== '' || !KNOWN_IMAP_DOMAINS.has(domain)`

## Out of Scope

* manifest 声明式条件字段（authSchema 通用机制）、扩展向宿主暴露已知域名列表

## Technical Notes

* 关键文件：`apps/desktop/src/components/settings/CollectorsSettings.tsx`（email 账户表单）、参考 `extensions/email-collector/src/emailEvents.ts` IMAP_HOSTS
