# AI 이미지 프롬프트 — 하이헤이호 (아동복)

실제 제품 사진을 **넣고** 바꾸는 용도다. 맨땅에서 옷을 만들어내면 실물과 달라져 반품이 는다.

> ⚠️ **아이 얼굴은 AI로 만들지 않는다.**
> 실제로 없는 아이를 만들어 광고에 쓰면 ①실물과 다른 착용감을 광고한 것이 되고 ②아동 이미지 생성은 플랫폼 정책상 막히거나 계정 제재로 이어진다.
> → **착용컷은 실촬영.** AI는 아래 1·2·3번(배경·소품·보정)에만 쓴다.

---

## 1. 배경 교체 — 누끼컷을 연출컷으로

```
Replace the background of this product photo. Keep the garment EXACTLY as is —
same color, same fabric texture, same shape, same folds. Do not redraw the clothing.

Background: soft beige studio backdrop, gentle natural window light from the left,
subtle soft shadow under the garment, warm and clean, minimal.

Style: Korean kids fashion brand lookbook, bright and airy, high-end but cozy.
Square 1:1. Photorealistic. No text, no logo, no props.
```

**배경 변형** (`Background:` 줄만 교체)

| 용도 | 넣을 문장 |
|---|---|
| 기본 상세페이지 | `clean off-white seamless studio backdrop, even soft light` |
| 봄·여름 | `light wooden floor with soft morning sunlight and faint leaf shadows` |
| 가을·겨울 | `warm cream knit blanket surface, soft diffused light` |
| 인스타 감성 | `pastel cream wall, dried flower in a vase blurred in the background` |

## 2. 평면 연출컷 (플랫레이) — 소품 얹기

```
Take this flat-lay garment photo and arrange it as a styled flat lay.
Keep the garment EXACTLY as photographed — do not alter color, pattern, or proportions.

Add around it: a pair of small white kids sneakers, a folded cotton blanket,
one dried eucalyptus stem. Neutral cream background, soft top light.

Composition: garment centered, props at the corners, generous empty space.
Korean kids brand aesthetic, warm neutral tones. Square 1:1. Photorealistic.
```

## 3. 색상 시안 — 생산 전 컬러 검토용

**판매용 아님.** 공장에 색 넘기기 전 내부 검토용이다.

```
Recreate this exact garment in the following color: [토마토 / 베이비블루 / 레몬 / 멜란지].
Keep the shape, fabric texture, stitching, and all details identical.
Only the fabric color changes. Flat lay on white, even lighting. Photorealistic.
```

> 실제 원단 색과 모니터 색은 다르다. **이걸로 최종 결정하지 말고** 스와치 실물로 확정할 것.

## 4. 광고 소재 배경 — 메타 광고용

```
Product photo composition for a Meta feed ad, 4:5 vertical.
Keep the garment exactly as in the source image.

Layout: garment on the lower two-thirds, clean empty space at the top for text overlay.
Background: soft gradient cream to pale peach. Warm natural light.
No text, no logo — leave the top area empty. Photorealistic.
```

> 문구는 AI에 맡기지 않는다. 글자를 그리게 하면 한글이 깨진다. **빈 공간만 만들고 문구는 따로 얹는다.**

---

## 쓰는 순서

1. 실촬영 누끼컷을 준비한다 (촬영-지시서 1번)
2. 위 프롬프트 + 그 사진을 같이 넣는다
3. 나온 결과를 **원본과 나란히 놓고** 색·형태가 변했는지 본다
4. 옷이 조금이라도 바뀌었으면 버린다 — `Keep the garment EXACTLY as is` 를 앞에 한 번 더 넣고 다시

## 안 되는 것

| 쓰지 말 것 | 이유 |
|---|---|
| AI로 만든 아이 모델 착용컷 | 실물과 다른 착용감 광고 + 플랫폼 제재 |
| AI로 만든 원단 질감 클로즈업 | 실제 원단과 달라 반품 사유가 된다 |
| AI가 그린 한글 문구 | 글자가 깨진다 |
| AI 생성 사이즈 비교컷 | 치수가 근거 없이 그려진다 |

## 결과물 보관

`촬영/생성물/<상품명>/` 아래에 두고, 원본 사진 파일명을 같이 적는다.
나중에 "이 컷 어디서 나온 거냐"를 못 찾으면 다시 못 만든다.
