import { Stage, Phone, type Act } from '../../kit'
import { ChevronLeft, Ticket } from 'lucide-react'
import './gacha.css'

import bg from './assets/bg-P3-01.jpg'
import s1 from './assets/sticker-P3-01.png'
import s2 from './assets/sticker-P3-02.png'
import s3 from './assets/sticker-P3-03.png'
import c1 from './assets/card-P1-30.jpg'
import c2 from './assets/card-P1-34.jpg'
import c3 from './assets/card-P1-22.jpg'
import c4 from './assets/card-P1-31.jpg'
import c5 from './assets/card-P2-30.jpg'
import c6 from './assets/card-P1-24.jpg'
import c7 from './assets/card-P1-06.jpg'
import c8 from './assets/card-P1-35.jpg'
import c9 from './assets/card-P2-22.jpg'
import c10 from './assets/card-P3-01.jpg'

// ウイニングロードのカード育成モード、ガチャの画面。スマホ 1 台、上から吊って下へ逃がす（phone-touch と同じ構図）。
// 筋は 4 拍：PICK UP のバナー（文脈）→「10 回引く」を押す（操作）→ 画面が結果まで送られ、10 枚が伏せて配られて
// 順にめくれる。最後の 1 枚だけ間を置いて金に光る（盛り上がり）→ その SSR を押すと、格子の中のカードがそのまま
// 大きくなって手前に来る（結果）。輪は「閉じる」で格子へ戻し、指で下へ払って上（バナー）へ戻す：最初の絵と同じ。
// 結果の欄は最初から前回の 10 枚で埋まっていて（画面の外）、引くたびに配り直す。だから輪の継ぎ目で何も巻き戻らない。
//
// 本物の文字：ガチャ・PICK UP・名馬ガチャ・生涯連対の SSR 3 頭・1 回引く・10 回引く・引いたカード・NEW・閉じる。
// カードの絵はゲームの撮影の舞台で撮ったもの（中の文字もゲームのとおり）。ほかは線か形。

type Deal = 'rest' | 'out' | 'down'
type S = { y: number; deal: Deal; flipped: number; glow: boolean; big: boolean; press: boolean }

const START: S = { y: 0, deal: 'rest', flipped: 10, glow: false, big: false, press: false }

const CARDS = [c1, c2, c3, c4, c5, c6, c7, c8, c9, c10]
const RARE = ['n', 'n', 'r', 'n', 'n', 'r', 'sr', 'n', 'r', 'ssr']
const HIT = 9

// 画面の中は iPhone の点（402 × 874）。格子は 5 列、カードは 630:880 の比
const PAD = 16
const GAP = 8
const CW = (402 - PAD * 2 - GAP * 4) / 5
const CH = CW * (880 / 630)
const RES_TOP = 466 // 中身の座標での結果の欄の上端（gacha.css の .gp-results と合わせる）
const GRID_TOP = RES_TOP + 40
const SCROLL = 160 // 結果まで送る量（10 回引くのボタンは画面に残す）
const BIG_W = 250
const BIG = { x: (402 - BIG_W) / 2, y: 132, w: BIG_W, h: BIG_W * (880 / 630) }
const REST = { x: 330, y: 400 }

const cell = (i: number) => ({ x: PAD + (i % 5) * (CW + GAP), y: GRID_TOP + Math.floor(i / 5) * (CH + GAP) })

const script = async (a: Act<S>) => {
  await a.wait(1200)
  a.mark('pull')
  await a.click('pull10')
  // 押した直後に伏せたカードに替え、画面を結果まで送る
  // 前回の 10 枚を払ってから、伏せて配り直す
  a.put({ deal: 'out', y: SCROLL })
  await a.wait(380)
  await a.snap({ flipped: 0 })
  a.put({ deal: 'down' })
  await a.wait(900)
  a.mark('flip')
  for (let i = 1; i <= 9; i++) {
    a.put({ flipped: i })
    await a.wait(140)
  }
  // 最後の 1 枚は溜めてから（光ってからめくれる）
  await a.wait(320)
  a.put({ glow: true })
  await a.wait(800)
  a.put({ flipped: 10 })
  await a.wait(1100)
  a.mark('open')
  await a.click('hit')
  a.put({ big: true })
  await a.wait(2600)
  a.mark('close')
  await a.click('close')
  a.put({ big: false })
  await a.wait(900)
  // 指で下へ払って上へ戻る（戻る理由を見せる）
  await a.move('scroller')
  a.mark('back')
  await a.drag({ at: 'scroller', y: 0.85 }, undefined, { duration: 520 })
  a.put({ y: 0, glow: false })
  await a.wait(900)
  await a.snap({ deal: 'rest' })
  await a.move(REST)
  await a.wait(200)
}

export default function GachaPull() {
  return (
    <Stage<S>
      width={400}
      height={470}
      compact={{ below: 400, width: 358, height: 470 }}
      initial={START}
      poster={{ y: SCROLL, deal: 'down', flipped: 10, glow: true, big: true, press: false }}
      script={script}
      cursor={{ at: REST, style: 'touch' }}
      className="gp"
    >
      {(s, _rect, layout) => {
        const from = cell(HIT)
        const sx = CW / BIG.w
        // 大きいカードは格子の 1 枚から伸びる。閉じているときは格子の位置・大きさに縮めて重ね、開くとそのまま手前へ
        const bigT = s.big
          ? 'translate(0px, 0px) scale(1)'
          : `translate(${from.x - BIG.x}px, ${from.y - s.y - BIG.y}px) scale(${sx})`
        return (
          <>
            <Phone width={layout === 'compact' ? 318 : 300} className="gp-phone" dark>
              <div className="gp-screen">
                <div className="gp-sky" />
                <div className="gp-scroll" data-target="scroller" style={{ transform: `translateY(${-s.y}px)` }}>
                  <div className="gp-banner">
                    <span className="gp-banner__bg" style={{ backgroundImage: `url(${bg})` }} />
                    <span className="gp-banner__shade" />
                    <img className="gp-hero gp-hero--3" src={s3} alt="" />
                    <img className="gp-hero gp-hero--2" src={s2} alt="" />
                    <img className="gp-hero gp-hero--1" src={s1} alt="" />
                    <div className="gp-banner__tx">
                      <span className="gp-tag">PICK UP</span>
                      <span className="gp-title">名馬ガチャ</span>
                      <span className="gp-sub">生涯連対の SSR 3 頭</span>
                    </div>
                  </div>
                  <div className="gp-btns">
                    <span className="gp-btn">1 回引く</span>
                    <span className="gp-btn gp-btn--main" data-target="pull10">
                      <Ticket size={18} strokeWidth={2.4} />
                      10 回引く
                    </span>
                  </div>
                  <div className="gp-results">
                    <span className="gp-rtitle">引いたカード</span>
                    <div className="gp-grid">
                      {CARDS.map((src, i) => {
                        const shown = i < s.flipped
                        return (
                          <span
                            key={i}
                            className={`gp-card gp-card--${RARE[i]}`}
                            data-dealt={s.deal !== 'out' || undefined}
                            data-up={shown || undefined}
                            data-glow={(i === HIT && s.glow) || undefined}
                            data-gone={(i === HIT && s.big) || undefined}
                            data-target={i === HIT ? 'hit' : undefined}
                            style={{ left: cell(i).x, top: cell(i).y - RES_TOP, width: CW, height: CH, transitionDelay: s.deal === 'down' ? `${i * 45}ms` : undefined }}
                          >
                            <span className="gp-card__in">
                              <span className="gp-card__back" />
                              <img className="gp-card__face" src={src} alt="" />
                            </span>
                            {i === HIT ? <span className="gp-new">NEW</span> : null}
                          </span>
                        )
                      })}
                    </div>
                  </div>
                </div>

                <div className="gp-top" />
                <header className="gp-head">
                  <span className="gp-back"><ChevronLeft size={22} strokeWidth={2.6} /></span>
                  <span className="gp-htitle">ガチャ</span>
                  <span className="gp-coin"><i />∞</span>
                </header>

                <div className="gp-veil" data-on={s.big || undefined} />
                <div
                  className="gp-big"
                  data-open={s.big || undefined}
                  style={{ left: BIG.x, top: BIG.y, width: BIG.w, height: BIG.h, transform: bigT }}
                >
                  <img src={c10} alt="ダイワスカーレット" />
                  <span className="gp-new gp-new--big">NEW</span>
                </div>
                <span className="gp-close" data-on={s.big || undefined} data-target="close">閉じる</span>
              </div>
            </Phone>
          </>
        )
      }}
    </Stage>
  )
}
