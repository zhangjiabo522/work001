# Cloudflare Worker Baby API

This Worker exposes a simple API endpoint:

- `GET /api/baby`

It fetches data from:

- `https://api.lolimi.cn/API/baby/gohome?type=json`

and returns the upstream JSON response directly.

## Local development

```bash
npm install
npm run dev
```

## Deploy

```bash
npm install
npm run deploy
```

## Example response

```json
{
  "code": 200,
  "data": {
    "id": 1448,
    "title": "陈宇鑫",
    "name": "陈宇鑫",
    "sex": "男",
    "height": "170cm",
    "born_date": "2006-09-28",
    "missing_age": 15,
    "missing_date": "2022-01-25",
    "missing_address": "重庆市江津区石门镇",
    "missing_feature": "头旋、断掌纹不详，1.7米，体重168斤，智力跟正常人比有明显差别，没有沟通能力",
    "lat": 29.107,
    "lng": 106.039,
    "contact": "0435-3338090",
    "create_time": "2022-02-10",
    "photo": "https://cdn.zhaolinlang.com/domi/public/uploads/20220210/56c2b0f9.jpg_295x413x3.jpg",
    "md_photo": "https://cdn.zhaolinlang.com/domi/public/uploads/20220210/56c2b0f9.jpg_300x300x3.jpg",
    "sm_photo": "https://cdn.zhaolinlang.com/domi/public/uploads/20220210/56c2b0f9.jpg_100x100x3.jpg",
    "missing_days": 1521,
    "now_age": 19,
    "url": "https://bbs.baobeihuijia.com/forum.php?mod=viewthread&tid=538036",
    "current": "current"
  },
  "time": "2026-03-25 13:21:23",
  "timestamp": 1774416083
}
```
