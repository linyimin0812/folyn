# email 表单已知域名加「如何获取授权码」帮助链接

## Goal

email 账户表单的密码/授权码字段是用户最常卡住的地方（QQ/163 要在网页邮箱设置里生成授权码）。对已知域名，在密码字段下加官方帮助页跳转链接。

## Requirements

* 已知域名（有官方帮助 URL 的）→ 密码/授权码字段下方显示「如何获取授权码？」链接
* 点击走应用外链打开路径（plugin-shell open / window.open），不用裸 href 导航（同 TimelineList openExternalUrl 模式）
* 未知域名 / 无把握官方 URL 的域名（如 sina）→ 不显示链接
* 链接域名 → URL 映射硬编码在 CollectorsSettings（ponytail：同 KNOWN_IMAP_DOMAINS 镜像惯例）

## Acceptance Criteria

* [x] 已知域名账户显示帮助链接，点击在系统浏览器打开
* [x] 未知域名不显示
* [x] desktop tsc 绿

## Technical Approach

* `AUTH_HELP_URLS: Record<domain, url>`（gmail 185833 / qq service.mail.qq.com/detail/0/75 / 163·126·yeah help.mail.163.com 授权码页 / outlook 系 account.live.com AppPassword / yahoo SLN15241 / icloud HT204397）
* accountField 加可选 `hint` 节点插在 label 与 input 之间；密码字段传链接

## Out of Scope

* i18n（沿用 email 表单硬编码 zh 惯例）、sina 等无把握 URL 的域名

## Technical Notes

* 关键文件：`apps/desktop/src/components/settings/CollectorsSettings.tsx`
