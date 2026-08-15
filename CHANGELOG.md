## [2.4.9](https://github.com/molvqingtai/WebChat/compare/v2.4.8...v2.4.9) (2026-08-15)

### Bug Fixes

- **runtime:** clean domain refresh and lawful presence rebinding ([42c4c7c](https://github.com/molvqingtai/WebChat/commit/42c4c7cb74fc3c76cf8bba439a871e3394d18ef7))
- **runtime:** decouple lifecycle evidence and drop reset debug logs ([3de4b37](https://github.com/molvqingtai/WebChat/commit/3de4b371876878b0a29bf7d8420ebe298acbf606))
- **runtime:** own concurrent resets and settle cleanup without a busy loop ([347cd6f](https://github.com/molvqingtai/WebChat/commit/347cd6f2d4569e6d457b956c8d4508531965f413))
- **runtime:** own the whole reconnect operation and split lifecycle evidence ([a5245ef](https://github.com/molvqingtai/WebChat/commit/a5245ef440ac6966d07baea7c9befda8fea0c20b))
- **runtime:** pin the Artico signaling endpoint to the owned server ([627440c](https://github.com/molvqingtai/WebChat/commit/627440c79a66e11a81196d7a0f010463973e98c3))
- **runtime:** settle refresh destruction and prove current source admission ([a06967b](https://github.com/molvqingtai/WebChat/commit/a06967bd7cad34fdadf40aebba6a397844a689a4))
- **runtime:** wait ten seconds for both network auto-recovery timers ([7b0ad7b](https://github.com/molvqingtai/WebChat/commit/7b0ad7b828aea8cdfeb1cbd74d34aed29cd230ac))

## [2.4.8](https://github.com/molvqingtai/WebChat/compare/v2.4.7...v2.4.8) (2026-08-12)

### Bug Fixes

- **runtime:** align content URL eligibility ([8f8303a](https://github.com/molvqingtai/WebChat/commit/8f8303a11df1a31b11896e1d022fda4ac0d82dd1))
- **runtime:** complete per-room repair round four ([e5794da](https://github.com/molvqingtai/WebChat/commit/e5794dac52a735a7083e54139b3b7b95fcb69f77))
- **runtime:** complete per-room repair round three ([20f466d](https://github.com/molvqingtai/WebChat/commit/20f466dc2390fc37b594bac0a0dc300f00397254))
- **runtime:** complete per-room repair round two ([e080d63](https://github.com/molvqingtai/WebChat/commit/e080d63813d3a05d442ff79d1fc47575f1899254))
- **runtime:** derive physical World departure from exact World demand ([a25d4c5](https://github.com/molvqingtai/WebChat/commit/a25d4c55c25ec011b6fa265c856b00222b3d39a3))
- **runtime:** settle release order, retry ownership, and scoped peer restart ([7b6dbd5](https://github.com/molvqingtai/WebChat/commit/7b6dbd5eebbb17e77483291e53fd73d27dd28dd4))
- **runtime:** tie World projection clearing to physical departure ([0417202](https://github.com/molvqingtai/WebChat/commit/0417202f5e29ebb8ac1c3759ed7c192e85bb6d18))

### Performance Improvements

- **content:** narrow excluded hosts ([53e17cb](https://github.com/molvqingtai/WebChat/commit/53e17cb63750d9a973b4b64df2b40315586c1bef))

## [2.4.7](https://github.com/molvqingtai/WebChat/compare/v2.4.6...v2.4.7) (2026-08-10)

### Performance Improvements

- **content:** exclude common authorization subdomains from content targeting ([80fc9fc](https://github.com/molvqingtai/WebChat/commit/80fc9fc53c151fd3bd1756aee4fd55a7a08f7b4d))

## [2.4.6](https://github.com/molvqingtai/WebChat/compare/v2.4.5...v2.4.6) (2026-08-09)

### Bug Fixes

- **runtime:** extend recovery cadences for peer restart and lease retry ([d5b9661](https://github.com/molvqingtai/WebChat/commit/d5b96619279757c2f207f17894137f14ef186c46))

## [2.4.5](https://github.com/molvqingtai/WebChat/compare/v2.4.4...v2.4.5) (2026-08-09)

### Bug Fixes

- **appbutton:** drop stale 60px comment residue in geometry owner ([4f3af3f](https://github.com/molvqingtai/WebChat/commit/4f3af3f13b3421fbde15447c3127c9cfd5153f54))
- **appbutton:** keep a fixed 60px outer-top margin on drag ([e8c713b](https://github.com/molvqingtai/WebChat/commit/e8c713b278603f2208bc9863d993be833b6fd926))
- **appbutton:** keep the largest feasible top margin below the threshold ([d61db88](https://github.com/molvqingtai/WebChat/commit/d61db880dc3717badb424eb1af0ba5af0a265acd))
- **appbutton:** set the collapsed top margin to 62px ([a8b1f9a](https://github.com/molvqingtai/WebChat/commit/a8b1f9ae9065772e1805982afbaa50c988cf389d))
- **protocol:** attempt-owned rebind authority and release settlement edges ([792cea1](https://github.com/molvqingtai/WebChat/commit/792cea15fd7de3f275ac3484baea4c39169bb3f9))
- **protocol:** attempt-owned rebind records and release-fenced deadlines ([90706f4](https://github.com/molvqingtai/WebChat/commit/90706f4b585095aed00be531e248e68c2d372936))
- **protocol:** current-binding selection and unprotected switch replacement ([0150b5d](https://github.com/molvqingtai/WebChat/commit/0150b5d2b0bec19fdafbd67f708c5649b1b30e6c))
- **protocol:** displaced-generation lifecycle and Wire-boundary dedup proof ([36655c2](https://github.com/molvqingtai/WebChat/commit/36655c2cf1ad5e9601bb50c2d15d946ad205b9c4))
- **protocol:** displaced-user finality and attempt-owned displaced commit facts ([bcca86e](https://github.com/molvqingtai/WebChat/commit/bcca86ee78f3fc543e69fec41eb4b04d169b7042))
- **protocol:** gate release on cleanup and fence observer grace lifecycle ([070705f](https://github.com/molvqingtai/WebChat/commit/070705f9bb1d38397bd1939562c87bdcddd83650))
- **protocol:** independent displaced-leave classification and prepared slot normalization ([ec83281](https://github.com/molvqingtai/WebChat/commit/ec83281f84e2d1f433bef47a9fe5197f10dfa52f))
- **protocol:** multi-source same-presence preparation precedence ([e8ea20e](https://github.com/molvqingtai/WebChat/commit/e8ea20e9f2c44ac3d72a50b81ab68ae58915b186))
- **protocol:** pending-gated promotion and structural rebind dedupe ([5983b33](https://github.com/molvqingtai/WebChat/commit/5983b33b3601aeddad4ab712679596cc24137c23))
- **protocol:** reconcile prepared observers on physical source departure ([70f0d56](https://github.com/molvqingtai/WebChat/commit/70f0d566af0cb1b30ca657e9b08e404bba80d814))
- **protocol:** revoke displaced facts on departure and per-user commit finality ([da1e747](https://github.com/molvqingtai/WebChat/commit/da1e747f058329e89fb4e27aca0f8fbc2fdb4e99))
- **protocol:** slot-keyed current bindings and source-removal gating ([23c41b6](https://github.com/molvqingtai/WebChat/commit/23c41b6926e765ad934ebd4e936b7266cb2100aa))
- **protocol:** source-bound rebind facts and absolute grace expiry ([d8109a3](https://github.com/molvqingtai/WebChat/commit/d8109a3394593a42ca6294f4effab114210498f4))
- **protocol:** source-scoped prepared observer reconciliation ([d57070d](https://github.com/molvqingtai/WebChat/commit/d57070d2b4def9ce1ef6a0fa14e50dad6f9f50c7))

### Performance Improvements

- **protocol:** declarative-only schemas, Pull/Push rename, write-trust, frame-bound privacy ([3b0adb0](https://github.com/molvqingtai/WebChat/commit/3b0adb075ab6c740c5ca8f058dc331c0efc5c134))
- **protocol:** schema-first protocol authority with two validation boundaries ([3709067](https://github.com/molvqingtai/WebChat/commit/3709067332161b7821902ec71e87f8481445326d))
- rename histoy message type ([b996f15](https://github.com/molvqingtai/WebChat/commit/b996f15508bd648471833b2e76b50a2fe6562f19))

## [2.4.4](https://github.com/molvqingtai/WebChat/compare/v2.4.3...v2.4.4) (2026-08-08)

### Bug Fixes

- toast message overflow ([58c6fce](https://github.com/molvqingtai/WebChat/commit/58c6fcecd2aea7bc179e20e308420a55cff2c973))

### Performance Improvements

- **protocol:** cleanup job partition, end-to-end send ownership, lifetime sync fence ([e194b3e](https://github.com/molvqingtai/WebChat/commit/e194b3ed78b8560b02de36d3cf7f10ff4af8d784))
- **protocol:** close admission identity, physical cleanup, terminal replay ([557e9ae](https://github.com/molvqingtai/WebChat/commit/557e9aee08b2ee634a62f3f49442bffddb4899ea))
- **protocol:** close admission saturation, cleanup settlement, terminal fence ([612ebc9](https://github.com/molvqingtai/WebChat/commit/612ebc9353d05c3a730c5df88d0a4c934f870982))
- **protocol:** close cleanup ownership, atomic promotion, test controls ([2f15ac7](https://github.com/molvqingtai/WebChat/commit/2f15ac7e0ccb1f13bd67e0c72353f93827c447f4))
- **protocol:** close exact-history paging/identity/admission P1 controls ([ea86c31](https://github.com/molvqingtai/WebChat/commit/ea86c318661d45f1bfde28ab1d3afe3b384a0d48))
- **protocol:** close exact-history state/paging/resource P1 controls ([47b4bf6](https://github.com/molvqingtai/WebChat/commit/47b4bf655d98411fc8ad1c0bc6095bba50ec4910))
- **protocol:** close provider admission/successor/queue P1 controls ([72572db](https://github.com/molvqingtai/WebChat/commit/72572db8c298ecf6872d6492022f9005ec18bdd4))
- **protocol:** close real-codec/provider/queue P1 controls ([9eb431f](https://github.com/molvqingtai/WebChat/commit/9eb431fe41c4a9bfa7203d6c8a4af37a85e74069))
- **protocol:** connection-bound one-sync history with constant-size terminal binding ([12aece5](https://github.com/molvqingtai/WebChat/commit/12aece5f96c67cbc15f4bbb4731abcd9dd6cf8e6))
- **protocol:** directional bounded sync fence, cleanup fencing, real dead-page evidence ([009472c](https://github.com/molvqingtai/WebChat/commit/009472ccfa8853c05c276ddaeb041b62b3cbcb26))
- **protocol:** per-attempt supply ownership and physical-exit cancellation ([e1b96c9](https://github.com/molvqingtai/WebChat/commit/e1b96c973262b83c2a9382db438ee4c7fc365bba))
- **protocol:** replace History with exact-ID diff sync and loading Toast ([ce7edc4](https://github.com/molvqingtai/WebChat/commit/ce7edc4b5cc77fbf3ae6784d4897c85350dbee1f))
- **protocol:** settlement-bound cancel, exhaustion terminal, timeout failover, slot-exact release ([f140d50](https://github.com/molvqingtai/WebChat/commit/f140d50ae99cb55aed85fc2f0bb4af5e994747e7))
- **protocol:** wire real supply cancellation and successor promotion after cleanup ([5e009b4](https://github.com/molvqingtai/WebChat/commit/5e009b4a22a952442c933be4d0fcf2b7f227766d))

## [2.4.3](https://github.com/molvqingtai/WebChat/compare/v2.4.2...v2.4.3) (2026-08-07)

### Bug Fixes

- **content:** fence BFCache restore by generation and support repeated cycles ([c610fd3](https://github.com/molvqingtai/WebChat/commit/c610fd3a145dd0d6e491b19823068ac645b4377a))
- **content:** make restore visible and hide-invalidatable, add composed control ([88a830d](https://github.com/molvqingtai/WebChat/commit/88a830da2536cc7dfe4435cca4f077f24a7a7504))
- **content:** restore hide idempotency and compose the production lifecycle owner ([7155641](https://github.com/molvqingtai/WebChat/commit/7155641fae3ad1df141a16475f3623d387ee3d81))
- **content:** silence readiness feedback on departure and restore once from BFCache ([9811ba0](https://github.com/molvqingtai/WebChat/commit/9811ba01798ca2ee241e09c29ead295197d3364f))

## [2.4.2](https://github.com/molvqingtai/WebChat/compare/v2.4.1...v2.4.2) (2026-08-07)

### Bug Fixes

- **runtime:** absorb transient recovery failures ([5fe769b](https://github.com/molvqingtai/WebChat/commit/5fe769b56efe5ef646ffbfad72f05d2508ffc242))
- **runtime:** carry sends through presence recovery ([7f71048](https://github.com/molvqingtai/WebChat/commit/7f71048971226403a2a1d074c632fd11e03820ac))
- **runtime:** drop the room id from the trusted-room invalid-message error text ([e950cb8](https://github.com/molvqingtai/WebChat/commit/e950cb833929f116b5549274eb2106b70f1f42b1))
- **runtime:** exact invocation-bound connection tokens and page-owned send teardown ([35fd884](https://github.com/molvqingtai/WebChat/commit/35fd884486c6c999f1e9b2043ac11f1ccd1a9fc5))
- **runtime:** make presence recovery handoff atomic ([949575d](https://github.com/molvqingtai/WebChat/commit/949575debd4aabbc836707b51e056b244952e7d1))
- **runtime:** no provider-send replay, single-target reject, scoped failures ([276658f](https://github.com/molvqingtai/WebChat/commit/276658f4a62b9dfd5bb50bdc452e325e75bd4827))
- **runtime:** own content transport rejections ([5d3dbb3](https://github.com/molvqingtai/WebChat/commit/5d3dbb3c188aaef331e77294c655279f4db36912))
- **runtime:** per-invocation send and connection owner results and correct release-cancel ([6c468c4](https://github.com/molvqingtai/WebChat/commit/6c468c46d232e3bb60a88e64c9b063d422718acb))
- **runtime:** per-operation structural lifecycle results and release step retry ([32d4b36](https://github.com/molvqingtai/WebChat/commit/32d4b362cf0cb08d7cfb9569c9e5013755c774f2))
- **runtime:** preserve initial terminal rejection ([3a0b611](https://github.com/molvqingtai/WebChat/commit/3a0b611d11b01b86322c111bb9e94db207065338))
- **runtime:** recover through current-generation lifecycle ([d9bb60e](https://github.com/molvqingtai/WebChat/commit/d9bb60e96421257e1ceb2aefa24c887509b22ac1))
- **runtime:** register presence recovery before yielding ([749f288](https://github.com/molvqingtai/WebChat/commit/749f288f186be8024abb093c30e7e3dad446b11b))
- **runtime:** report superseded connection as cancelled and consume every task result ([72f1ebd](https://github.com/molvqingtai/WebChat/commit/72f1ebdcd86558e513825d0dffe6b12e09fb399c))
- **runtime:** settle native errors once ([70963d3](https://github.com/molvqingtai/WebChat/commit/70963d3bf302d425ae47f7092be4412be16f7a51))
- **runtime:** single live release owner without a durable end journal ([bd55864](https://github.com/molvqingtai/WebChat/commit/bd55864985a3c9861278875979683e2041b6dcc0))
- **runtime:** strict single-owner release with World continuation and scoped errors ([cb39417](https://github.com/molvqingtai/WebChat/commit/cb39417219c8abb012aa72ded3725b0d2026187d))
- **runtime:** structural lifecycle cancellation and release closure ([8510dcc](https://github.com/molvqingtai/WebChat/commit/8510dcc13655d8bcd102b955f783a5317845b113))
- **runtime:** surface terminal native errors ([4eefc56](https://github.com/molvqingtai/WebChat/commit/4eefc56f2906854763382c941dbf3d2620dd9c1c))
- **runtime:** typed lifecycle outcomes and per-target send settlement ([d393630](https://github.com/molvqingtai/WebChat/commit/d393630a81867c76a963ec13c0acd7333847ca9e))

## [2.4.1](https://github.com/molvqingtai/WebChat/compare/v2.4.0...v2.4.1) (2026-08-05)

### Bug Fixes

- **message-list:** release initial no-scroll message list repair ([b543cb4](https://github.com/molvqingtai/WebChat/commit/b543cb4a6a2efc9dca86d36e9ffabdf07ffed228))

# [2.4.0](https://github.com/molvqingtai/WebChat/compare/v2.3.0...v2.4.0) (2026-08-04)

### Bug Fixes

- **app-button:** settle reduced-motion identity directly ([60e4fe9](https://github.com/molvqingtai/WebChat/commit/60e4fe9458952dd56db27d970704249999badba8))
- **app-status:** order author updates across tabs ([da63af8](https://github.com/molvqingtai/WebChat/commit/da63af882a5e0752e535da520f625fc9eb718b81))
- **app-status:** preserve open ownership during delivery ([f5e7237](https://github.com/molvqingtai/WebChat/commit/f5e72375563e995d1ac3c67d6768248c156a363f))
- **app-status:** use shared open order for deliveries ([659308b](https://github.com/molvqingtai/WebChat/commit/659308ba958557a6e8bf440146781e0e184b2391))
- **content:** animate shell edge changes during opening ([72a45a3](https://github.com/molvqingtai/WebChat/commit/72a45a32746d879f95899dbe60c02974bff3585f))
- **content:** keep preview mounted during image switches ([d69f9ed](https://github.com/molvqingtai/WebChat/commit/d69f9edc920104eb673138a88ed4163189060bc8))
- **content:** separate shell translate ownership ([446c153](https://github.com/molvqingtai/WebChat/commit/446c153b38cb35e77847da2c2400ed04e7c1bd59))
- **danmaku:** gate pushes by document visibility ([286ffca](https://github.com/molvqingtai/WebChat/commit/286ffca85868f4e6ad0998fdb30ecfba2596d45b))
- **danmaku:** limit presentation to visible documents ([d078fa4](https://github.com/molvqingtai/WebChat/commit/d078fa4a9c4ae175d2e8d0784d344f80c8b99145))
- **danmaku:** synchronize visibility eligibility ([fb50b58](https://github.com/molvqingtai/WebChat/commit/fb50b58d65dec5613647226d2a6228c7e55c195b))

### Features

- **app-button:** fade launcher identity changes ([4e7352c](https://github.com/molvqingtai/WebChat/commit/4e7352c8901e4c8edf31308d59b51f1e2f55759f))
- **content:** toggle and replace image previews ([82823dd](https://github.com/molvqingtai/WebChat/commit/82823dd52422ce7427feeb6c331bdd42306e9ff3))
- **ui:** show latest message author in launcher ([36d6924](https://github.com/molvqingtai/WebChat/commit/36d6924f25caa48ffffd64c01d821fe35e1e3698))

# [2.3.0](https://github.com/molvqingtai/WebChat/compare/v2.2.0...v2.3.0) (2026-08-03)

### Bug Fixes

- **app-button:** preserve expanded shell top inset ([34ab956](https://github.com/molvqingtai/WebChat/commit/34ab956cfda7008c8e33fac2b7328c8a1386ecf9))
- **content:** unify shell and launcher geometry ([e3d0bc3](https://github.com/molvqingtai/WebChat/commit/e3d0bc32456e8e9e1417bb21a1b679bcfc54f0b6))
- **runtime:** shorten error messages ([231e330](https://github.com/molvqingtai/WebChat/commit/231e330c1ae640fd2d9bdaaba527270cd5b74ab6))

### Features

- **content:** highlight reactions and preview message images ([e8d8ae4](https://github.com/molvqingtai/WebChat/commit/e8d8ae426cff805400d1d6787406f2a1fae70558))

# [2.2.0](https://github.com/molvqingtai/WebChat/compare/v2.1.1...v2.2.0) (2026-08-01)

### Bug Fixes

- **app-button:** restore minimum edge margins ([36d4cb3](https://github.com/molvqingtai/WebChat/commit/36d4cb3d33bb6835cb44217e41b8efc8c87738ba))
- **app-status:** centralize launcher state and projection ([1c90b79](https://github.com/molvqingtai/WebChat/commit/1c90b7931a19aecdc3edb1c17fe87584d3a63240))
- **app-status:** sync shared launcher state ([b40259e](https://github.com/molvqingtai/WebChat/commit/b40259e3dd36695bc746e0a6fa03f56926efea0e))
- **content:** replace initialization loading toast with its error successor ([71ff3d0](https://github.com/molvqingtai/WebChat/commit/71ff3d04ee4acf015363bc5c67a5a23f5413d708))
- **content:** run Firefox persistence preparation without Web Locks ([5d6aff7](https://github.com/molvqingtai/WebChat/commit/5d6aff72c96b11a23272956aee9755db108edc26))
- **danmaku:** route app opening through private callback ([19c1d43](https://github.com/molvqingtai/WebChat/commit/19c1d43eb5c5b0c9c821d9367c17eef242432c5d))
- **notification:** use focused current tab domain ([bc06286](https://github.com/molvqingtai/WebChat/commit/bc0628657367d73b9c5b4fd2dc5ebf0c59e46709))
- **runtime:** preserve error messages across extension transport ([6ef8d74](https://github.com/molvqingtai/WebChat/commit/6ef8d740b0e096b7558cff366f7418278b9851d3))

### Features

- **notification:** activate matching tab on click ([4ae6bf5](https://github.com/molvqingtai/WebChat/commit/4ae6bf55cb51927fa72645231ef961bd1e437d51))

## [2.1.1](https://github.com/molvqingtai/WebChat/compare/v2.1.0...v2.1.1) (2026-07-31)

### Bug Fixes

- **content:** enforce initialization attempt deadline ([c4e22ed](https://github.com/molvqingtai/WebChat/commit/c4e22ed7a73be76f8be79e3a860346cf707b1baa))
- **content:** gate Runtime startup by attempt deadline ([aef4244](https://github.com/molvqingtai/WebChat/commit/aef4244f18b33b6cfdc921ea9aeab034de19c502))
- **content:** keep initialization inside app shell ([9eee4e9](https://github.com/molvqingtai/WebChat/commit/9eee4e9d5f1fcda098c222444ea2673610707b54))
- **content:** preserve Toaster viewport placement ([416c816](https://github.com/molvqingtai/WebChat/commit/416c816968b49c1d9172a8a1d6beb01b75c975ee))
- **content:** restore shell state before bootstrap ([a245c06](https://github.com/molvqingtai/WebChat/commit/a245c06c1e2f391c0812a90803114ac962736d50))
- **content:** restore single-shell initialization ([f8b6f74](https://github.com/molvqingtai/WebChat/commit/f8b6f741735119b3e25bd416e0f358d7b9e143be))
- **storage:** preserve shell status on version reset ([8f1f1d2](https://github.com/molvqingtai/WebChat/commit/8f1f1d258a486b0a78908346acb415272de56875))

# [2.1.0](https://github.com/molvqingtai/WebChat/compare/v2.0.1...v2.1.0) (2026-07-31)

### Bug Fixes

- **content:** defer runtime dependencies until ready ([c318974](https://github.com/molvqingtai/WebChat/commit/c318974a887452485862b00cc232fe21a72bf2d0))
- **content:** keep shell available during bootstrap ([f43c151](https://github.com/molvqingtai/WebChat/commit/f43c1511f13ca72adc4a6eea80f3570bc7945503))
- **content:** keep shell visible through status loading ([5b40948](https://github.com/molvqingtai/WebChat/commit/5b409481ea5785200f836fdd08f0164b8400e424))
- **content:** preserve shell through runtime handoff ([6f2fc86](https://github.com/molvqingtai/WebChat/commit/6f2fc8622d3557aa8139642c373fd071e87d29f3))
- **persistence:** use canonical IndexedDB identity ([eec7195](https://github.com/molvqingtai/WebChat/commit/eec7195f5dcdd1f26b8c86651d51d1361e8882f4))
- **runtime:** settle cancelled history supplies ([24dbf85](https://github.com/molvqingtai/WebChat/commit/24dbf85ed721533c6faa4c8ebde168878e0a6d5f))
- **runtime:** settle page connection completion ([e661598](https://github.com/molvqingtai/WebChat/commit/e661598989e70b67c6437db86ad773ec5e745cc0))
- **storage:** lock message database deletion ([b0254c2](https://github.com/molvqingtai/WebChat/commit/b0254c2c864385b4d911a42a6a4e57dde9d0f222))
- **storage:** replace stalled preparation generations ([838824b](https://github.com/molvqingtai/WebChat/commit/838824b8bf3b30a0ad13c91a17984332eb5279dd))
- **storage:** require cross-context preparation locks ([f44f250](https://github.com/molvqingtai/WebChat/commit/f44f25015a38d4ef65d94a8b768d9e620d8f3463))
- **toast:** preserve error default duration ([34d10cf](https://github.com/molvqingtai/WebChat/commit/34d10cf83e62b8e43e08866da234dabf37b20b8b))

### Features

- reset incompatible persistence stores ([e9eaead](https://github.com/molvqingtai/WebChat/commit/e9eaead37d2bdedae2d4d0b17a981ddfc7db7629))
- **storage:** use version-neutral message identity ([c983691](https://github.com/molvqingtai/WebChat/commit/c98369120cbf5d323d5f08c9694ffc1de3c7e48e))

## [2.0.1](https://github.com/molvqingtai/WebChat/compare/v2.0.0...v2.0.1) (2026-07-29)

### Bug Fixes

- **background:** select platform action API ([f9efac9](https://github.com/molvqingtai/WebChat/commit/f9efac92af9e0c7147f75dd36ec0f1dd67e8183f))
- **chat-room:** restore refresh after failed join ([a602149](https://github.com/molvqingtai/WebChat/commit/a602149522c7038f29e13307bb925a48ed3848d7))
- **e2e:** fence Firefox action operation inventory ([1b1f6cc](https://github.com/molvqingtai/WebChat/commit/1b1f6cc61d7de9adc75bca0cc1b3768d90555e04))
- **e2e:** preserve Firefox action content control ([d52ae27](https://github.com/molvqingtai/WebChat/commit/d52ae27095d919dc24e8ddc800ad7e5bfe1057ce))
- **e2e:** preserve Firefox tab identity across handles ([d1397d3](https://github.com/molvqingtai/WebChat/commit/d1397d3f3e028f0e99221279aa41211b5ad81592))
- **runtime:** fence connection feedback ownership ([b8f5a4a](https://github.com/molvqingtai/WebChat/commit/b8f5a4a8d4c001a4963be706dab7c6891efe75c5))
- **runtime:** serialize exact binding release ([2f60913](https://github.com/molvqingtai/WebChat/commit/2f60913259f9ce834ffdf75f63eef87c9563e644))

# [2.0.0](https://github.com/molvqingtai/WebChat/compare/v1.9.7...v2.0.0) (2026-07-27)

- feat!: release WebChat 2.0 ([fff7da8](https://github.com/molvqingtai/WebChat/commit/fff7da8e4e6f320a86d45670e108cd97451955e5))

### Bug Fixes

- **chat:** normalize reconnect rejections ([fb3d1dd](https://github.com/molvqingtai/WebChat/commit/fb3d1dd6cd02bfdb8fdf0c3ee9642f0ade1e5f1b))
- **ci:** derive Chrome context identity ([5a7bb4a](https://github.com/molvqingtai/WebChat/commit/5a7bb4a12c301bd4e51b4904253739e41091a4f8))
- **ci:** prepare isolated test workspace ([a03e2d1](https://github.com/molvqingtai/WebChat/commit/a03e2d168b5bd65476a516226f2b48a862c58a30))
- **ci:** prepare WXT before typecheck ([56ebff5](https://github.com/molvqingtai/WebChat/commit/56ebff521299b3644d7bf3b2a4858958388e2918))
- fixed dependency, prevent build errors ([35febaa](https://github.com/molvqingtai/WebChat/commit/35febaa9cd388820e2048fde386a8c874e6f517f))
- rewrite rendering displays blank ([9f28641](https://github.com/molvqingtai/WebChat/commit/9f286415f20b66a27e7f4d2c1e40e9f9586d6f57))
- **service:** isolate background RPC namespaces ([b1fcb66](https://github.com/molvqingtai/WebChat/commit/b1fcb6687b5c0bec2c844ab9cc2392057f6e6874))
- **ui:** animate notices and show reconnect feedback ([d3906bb](https://github.com/molvqingtai/WebChat/commit/d3906bbae26e050e3f6de7bd9f459a85348299b2))
- **ui:** make reconnect feedback request-owned ([a74d55b](https://github.com/molvqingtai/WebChat/commit/a74d55b741a2e124aac7006967a9c6f3982ba784))
- **ui:** publish toast surface after subscription ([f4d9c40](https://github.com/molvqingtai/WebChat/commit/f4d9c40199e3f73455a16b0194848ec888d7e78c))
- **ui:** replay active toast after remount ([ce1693b](https://github.com/molvqingtai/WebChat/commit/ce1693b8796c3c86977b9bcce3c8c2688bb5e391))
- **ui:** replay active toasts after remount ([6069170](https://github.com/molvqingtai/WebChat/commit/606917050685e95c4ee3807085b3467ef3631036))
- **ui:** restore AppMain reconnect toast flow ([4a26a59](https://github.com/molvqingtai/WebChat/commit/4a26a59ec3a417bb9761fb8666a64eab30e7dddb))
- **ui:** stop repeated readiness feedback ([4f53598](https://github.com/molvqingtai/WebChat/commit/4f535988ed92664597e0ea1a666e1537d8cf011c))
- **ui:** unify generic toast presentation ([7f0ccd7](https://github.com/molvqingtai/WebChat/commit/7f0ccd7e2120f476faf0de99d7264ba62837d2ec))
- unwrap jsonr commonjs default export ([1e441a0](https://github.com/molvqingtai/WebChat/commit/1e441a0a285b6a054f52b8361b3333a581dcd62c))

### Performance Improvements

- change join toast type ([3cf0bf0](https://github.com/molvqingtai/WebChat/commit/3cf0bf03e3ecdfd1db9f4b18e7a739030c41052e))
- getRootNode -> useRoot ([9507a0f](https://github.com/molvqingtai/WebChat/commit/9507a0fe9ae8a533396ec66d04f222c3a8e79fa1))

### BREAKING CHANGES

- WebChat 2.0 is not wire-compatible with 1.x clients.

## [1.9.7](https://github.com/molvqingtai/WebChat/compare/v1.9.6...v1.9.7) (2025-10-06)

### Performance Improvements

- **toast:** show synced message count in history sync notification ([0dd074c](https://github.com/molvqingtai/WebChat/commit/0dd074c100ca3c70175236abb19bb30754c1feaa))

## [1.9.6](https://github.com/molvqingtai/WebChat/compare/v1.9.5...v1.9.6) (2025-10-04)

### Bug Fixes

- specify target peers when sending messages to avoid connection errors ([ac0d22f](https://github.com/molvqingtai/WebChat/commit/ac0d22fa1518e763e1de78ede52346a4d7ece036)), closes [#56](https://github.com/molvqingtai/WebChat/issues/56)

## [1.9.5](https://github.com/molvqingtai/WebChat/compare/v1.9.4...v1.9.5) (2025-10-03)

### Performance Improvements

- **notification:** improve notification logic and smart filtering ([b2432df](https://github.com/molvqingtai/WebChat/commit/b2432dfc662560ecf911b3740ebf45dbbecd5632))

## [1.9.4](https://github.com/molvqingtai/WebChat/compare/v1.9.3...v1.9.4) (2025-10-02)

### Bug Fixes

- add namespace to notification proxy to prevent cross-extension conflicts ([2429fd4](https://github.com/molvqingtai/WebChat/commit/2429fd40b7e5c6b4374d938ac03f88dbe44a04c3))

## [1.9.3](https://github.com/molvqingtai/WebChat/compare/v1.9.2...v1.9.3) (2025-10-01)

### Performance Improvements

- add automatic IndexDB cleanup on extension update ([7a1a622](https://github.com/molvqingtai/WebChat/commit/7a1a6224f77e81ff1c5dd56be13897f5dce190c4))

## [1.9.2](https://github.com/molvqingtai/WebChat/compare/v1.9.1...v1.9.2) (2025-10-01)

### Performance Improvements

- enhance site metadata extraction with more fallback selectors ([71cf8af](https://github.com/molvqingtai/WebChat/commit/71cf8af0ad6d9eb4b7a3358453beb9131b3f8b50))

## [1.9.1](https://github.com/molvqingtai/WebChat/compare/v1.9.0...v1.9.1) (2025-10-01)

### Performance Improvements

- add URL sanitization to prevent XSS attacks ([f03a679](https://github.com/molvqingtai/WebChat/commit/f03a67947819fb34956e7265f7f11d26fca6be14))
- optimize Virtuoso performance for message list ([15e6706](https://github.com/molvqingtai/WebChat/commit/15e67066fca322d135829ba82aa9df18507db77b))

# [1.9.0](https://github.com/molvqingtai/WebChat/compare/v1.8.6...v1.9.0) (2025-10-01)

### Bug Fixes

- prevent setup component render before userInfo loads ([cae3a08](https://github.com/molvqingtai/WebChat/commit/cae3a08811d3885bf409a8a86e9fd5322ee4a504))

### Features

- add message send throttling and fix IME composition issue ([2d3e6db](https://github.com/molvqingtai/WebChat/commit/2d3e6db7318841577d0a368dbf7ffd791b3fc8c7))

### Performance Improvements

- optimize drag/resize performance with RAF and prevent unnecessary re-renders ([82577d0](https://github.com/molvqingtai/WebChat/commit/82577d0bcdca7c46d20128e51bc128662e201647))
- optimize message sync with hash comparison ([da8c411](https://github.com/molvqingtai/WebChat/commit/da8c411ac5a34e808b0fcf7a6cb591c32387d9ee))
- use useLayoutEffect for beforeunload listener to ensure early registration ([97e9574](https://github.com/molvqingtai/WebChat/commit/97e957420ceaa80ca04380c68179716c612643d6))

## [1.8.6](https://github.com/molvqingtai/WebChat/compare/v1.8.5...v1.8.6) (2025-09-30)

### Bug Fixes

- resolve ESLint warnings and errors ([38e10ba](https://github.com/molvqingtai/WebChat/commit/38e10baebfa2eb664dd8e8cf3621b4dd8c27bfef))

### Performance Improvements

- deduplicate join/leave messages to reduce spam ([2782b43](https://github.com/molvqingtai/WebChat/commit/2782b43d4341dcf828cc79308e7d30c634834f34))
- improve virtual scroll and simplify message sending ([411a38f](https://github.com/molvqingtai/WebChat/commit/411a38fa3b4f70335ed4116dc3ed277ec58a1596))
- optimize app positioning and message sending performance ([0bfaa07](https://github.com/molvqingtai/WebChat/commit/0bfaa07258b57bc8a4acecf4c9b73baf47d58181))
- optimize message sync with batched processing ([f19bace](https://github.com/molvqingtai/WebChat/commit/f19bacef560d0bfa4273b2c96cf6364d8c1dc350))

## [1.8.5](https://github.com/molvqingtai/WebChat/compare/v1.8.4...v1.8.5) (2025-05-30)

### Performance Improvements

- optimize style ([254ca88](https://github.com/molvqingtai/WebChat/commit/254ca8844dd535a65b26638871abaa52389f7416))
- scroll-area default scrollLock ([d00aee4](https://github.com/molvqingtai/WebChat/commit/d00aee48a4a90a5ad8f840f0af8251753e4f10a0))

### Reverts

- firefox falls back to manifest v2 ([943d64c](https://github.com/molvqingtai/WebChat/commit/943d64cf1e9c5b2b01c2480dd75607a9467da00e))

## [1.8.4](https://github.com/molvqingtai/WebChat/compare/v1.8.3...v1.8.4) (2025-05-22)

### Performance Improvements

- performance optimization ([dce12eb](https://github.com/molvqingtai/WebChat/commit/dce12ebf427d82c9a50f6d5da4f715885c0f7539))

## [1.8.3](https://github.com/molvqingtai/WebChat/compare/v1.8.2...v1.8.3) (2025-05-22)

### Bug Fixes

- drag crash ([54b7144](https://github.com/molvqingtai/WebChat/commit/54b7144f7b0711b26ade0f2851c614b905e88b0d))

### Performance Improvements

- empty messsage focus input ([403a522](https://github.com/molvqingtai/WebChat/commit/403a5228569d4fbe2d0ff1279e7b218cec7f130f))

## [1.8.2](https://github.com/molvqingtai/WebChat/compare/v1.8.1...v1.8.2) (2025-05-21)

### Bug Fixes

- sync history message ([e42f344](https://github.com/molvqingtai/WebChat/commit/e42f34479e166bbb67957449e4eb5edd9f390b84))

## [1.8.1](https://github.com/molvqingtai/WebChat/compare/v1.8.0...v1.8.1) (2025-05-21)

### Bug Fixes

- z-infinity not working ([192359b](https://github.com/molvqingtai/WebChat/commit/192359bf1cbbad77a15e98cc52129e0eacad51f7))

# [1.8.0](https://github.com/molvqingtai/WebChat/compare/v1.7.3...v1.8.0) (2025-05-21)

### Features

- upgrade to tailwind v4 ([9214708](https://github.com/molvqingtai/WebChat/commit/92147083c2978a6ce7f2d4fa0751b5ef9fa4797b))

## [1.7.3](https://github.com/molvqingtai/WebChat/compare/v1.7.2...v1.7.3) (2025-01-14)

### Bug Fixes

- incomplete validation of message format ([b8cf28b](https://github.com/molvqingtai/WebChat/commit/b8cf28bf2bb6d0fe4d0f14176799cc331066ae9d))

### Performance Improvements

- optimize style ([96f19bf](https://github.com/molvqingtai/WebChat/commit/96f19bfc3ac97987eea54bcc1c6ce8246e62d034))

## [1.7.2](https://github.com/molvqingtai/WebChat/compare/v1.7.1...v1.7.2) (2024-11-18)

### Performance Improvements

- notification type default `[@self](https://github.com/self)` ([7f94e37](https://github.com/molvqingtai/WebChat/commit/7f94e37f73f021aaa97d91fd911c299d709be52a))
- optimize online style ([8db7959](https://github.com/molvqingtai/WebChat/commit/8db79599e1d00e5405f4c8fdc329d830755cf6c9))
- optimize setup page message logic ([442fc99](https://github.com/molvqingtai/WebChat/commit/442fc993a36634805aeb91ee6222d416259ae39a))
- support icon click & optimize notification click logic ([074fc74](https://github.com/molvqingtai/WebChat/commit/074fc7403e0fc1e507d8e2aaf9a4f890157c4b25))

## [1.7.1](https://github.com/molvqingtai/WebChat/compare/v1.7.0...v1.7.1) (2024-11-15)

### Bug Fixes

- parse icon url error ([7763f34](https://github.com/molvqingtai/WebChat/commit/7763f34d5d07a104f8a66e53b05a7f87a4e0da28))

### Performance Improvements

- add number animation ([eb37dd2](https://github.com/molvqingtai/WebChat/commit/eb37dd28338d9e5420c91fb3d25c318411bdfd31))
- compatible with rectangular icons ([b860b16](https://github.com/molvqingtai/WebChat/commit/b860b16e908a744f615c8cea35a3dcd4ca008f1a))
- optimize scrollbar ([c5185e4](https://github.com/molvqingtai/WebChat/commit/c5185e419c5e175b8bc30e3f2b2207c18b9503b2))

# [1.7.0](https://github.com/molvqingtai/WebChat/compare/v1.6.6...v1.7.0) (2024-11-13)

### Features

- ranking of users supporting online websites Closes [#48](https://github.com/molvqingtai/WebChat/issues/48) ([d0fea9e](https://github.com/molvqingtai/WebChat/commit/d0fea9e42d52d0e56171c08ed780066d66ebe3f1))

## [1.6.6](https://github.com/molvqingtai/WebChat/compare/v1.6.5...v1.6.6) (2024-11-09)

### Bug Fixes

- the number of online users is inaccurate ([c6301a8](https://github.com/molvqingtai/WebChat/commit/c6301a826ebcf38a34b93a02c8013dd1ef9e7abc))

### Performance Improvements

- optimize taost dark mode ([00f0bd0](https://github.com/molvqingtai/WebChat/commit/00f0bd08b04e49f83cee60bb5767acd460a1b5d0))
- theme mode is compatible with website themes by default ([6222e3f](https://github.com/molvqingtai/WebChat/commit/6222e3f8af1bf4fad2466a9bf88c3b3159478a86))

## [1.6.5](https://github.com/molvqingtai/WebChat/compare/v1.6.4...v1.6.5) (2024-11-07)

### Performance Improvements

- delete setup exit animation ([d325be4](https://github.com/molvqingtai/WebChat/commit/d325be4becf562d2232a1a1e9a4e1582e44869a2))

## [1.6.4](https://github.com/molvqingtai/WebChat/compare/v1.6.3...v1.6.4) (2024-11-07)

### Performance Improvements

- check message format ([f6864e0](https://github.com/molvqingtai/WebChat/commit/f6864e06be01fd434136901ae85278ed4eab4c03))

## [1.6.3](https://github.com/molvqingtai/WebChat/compare/v1.6.2...v1.6.3) (2024-11-06)

### Performance Improvements

- optimize image processing ([9438a31](https://github.com/molvqingtai/WebChat/commit/9438a3169dfda166776610ba6aac1ac168231636))

## [1.6.2](https://github.com/molvqingtai/WebChat/compare/v1.6.1...v1.6.2) (2024-11-04)

### Bug Fixes

- incompatible with old data of userInfo, causing crash ([d5ced07](https://github.com/molvqingtai/WebChat/commit/d5ced0718f586ca156e80c56078ae1f3de4ee917))

## [1.6.1](https://github.com/molvqingtai/WebChat/compare/v1.6.0...v1.6.1) (2024-11-03)

### Bug Fixes

- sooner style ([7e49ec2](https://github.com/molvqingtai/WebChat/commit/7e49ec210ed706a0ee94b3c2b7b17af719b604e1))

# [1.6.0](https://github.com/molvqingtai/WebChat/compare/v1.5.4...v1.6.0) (2024-11-03)

### Features

- support offline message sync [#45](https://github.com/molvqingtai/WebChat/issues/45) ([7c4f655](https://github.com/molvqingtai/WebChat/commit/7c4f65573c591da2a8c8938e14066cee96d15b40))

## [1.5.4](https://github.com/molvqingtai/WebChat/compare/v1.5.3...v1.5.4) (2024-10-31)

### Performance Improvements

- support reading image from the clipboard ([362d7db](https://github.com/molvqingtai/WebChat/commit/362d7db7386d978c6d053a3e7262adf844e24f55))

## [1.5.3](https://github.com/molvqingtai/WebChat/compare/v1.5.2...v1.5.3) (2024-10-30)

### Bug Fixes

- insertion cursor position is incorrect ([2987c2d](https://github.com/molvqingtai/WebChat/commit/2987c2d85dd84639c06848ddc5cd4dc0b3288538))

## [1.5.2](https://github.com/molvqingtai/WebChat/compare/v1.5.1...v1.5.2) (2024-10-30)

### Performance Improvements

- optimize theme style ([7b91944](https://github.com/molvqingtai/WebChat/commit/7b91944fbf60c27d21274ddb7f28f97344c89ef5))

## [1.5.1](https://github.com/molvqingtai/WebChat/compare/v1.5.0...v1.5.1) (2024-10-29)

### Bug Fixes

- incompatibility with old data causes app to crash ([bd07bdc](https://github.com/molvqingtai/WebChat/commit/bd07bdc2c3df031d5a04d3eebade5d7fc7672600))

# [1.5.0](https://github.com/molvqingtai/WebChat/compare/v1.4.0...v1.5.0) (2024-10-29)

### Features

- support send image button ([a01a93f](https://github.com/molvqingtai/WebChat/commit/a01a93f260c3fefadb1ad1ce0369af3ea8c6b3f0))

# [1.4.0](https://github.com/molvqingtai/WebChat/compare/v1.3.1...v1.4.0) (2024-10-28)

### Bug Fixes

- delete bad z-index ([bcdd435](https://github.com/molvqingtai/WebChat/commit/bcdd435e45e0b39d2c3ac45fbe594609165bacd8))

### Features

- app button support drag ([4eba638](https://github.com/molvqingtai/WebChat/commit/4eba638a367d4be2dc3d0b3e378298fd98a9ff5d))
- support [@user](https://github.com/user) syntax ([bef576a](https://github.com/molvqingtai/WebChat/commit/bef576a77bc995e8eaf57de212a233081be34727))
- support dark mode ([010aa2f](https://github.com/molvqingtai/WebChat/commit/010aa2f45e8cf864ac54fed44668369b5ff8fd9e))

### Performance Improvements

- optimize danmuku theme styles ([4f6eb56](https://github.com/molvqingtai/WebChat/commit/4f6eb560fe88e5e7e5d5b920666ed5e19b952fe9))
- optimize header theme styles ([025166e](https://github.com/molvqingtai/WebChat/commit/025166ead5529f66c26810e6b7ab6ba07dd874aa))
- optimize theme styles ([2d051fe](https://github.com/molvqingtai/WebChat/commit/2d051fedd763427d10ac2c0c1a0bd74fe7788501))
- reset app position when window resize ([eee1735](https://github.com/molvqingtai/WebChat/commit/eee17356545515905813f5937b4dbe183fb081ed))

## [1.3.1](https://github.com/molvqingtai/WebChat/compare/v1.3.0...v1.3.1) (2024-10-16)

### Bug Fixes

- missing tabs permission ([3cfc16c](https://github.com/molvqingtai/WebChat/commit/3cfc16c9ee0f3f46c8b5692c02e5c569f40744c9))

# [1.3.0](https://github.com/molvqingtai/WebChat/compare/v1.2.2...v1.3.0) (2024-10-12)

### Bug Fixes

- p2p use artico ([a0a8462](https://github.com/molvqingtai/WebChat/commit/a0a8462f5ff55a50511e335f70f5b814f2713358))

### Features

- support notification ([9898718](https://github.com/molvqingtai/WebChat/commit/9898718b1a14605d140852faca74b8af12f9b2a2))

### Performance Improvements

- notification supports clicking to open the source website ([653229c](https://github.com/molvqingtai/WebChat/commit/653229c8fa1ef748c84c4a5cec756a42f51933ab))

## [1.2.2](https://github.com/molvqingtai/WebChat/compare/v1.2.1...v1.2.2) (2024-10-11)

### Bug Fixes

- danmuku message ellipsis ([e8e243e](https://github.com/molvqingtai/WebChat/commit/e8e243ee096a0fb22183170ef3c0005291b72870))
- online text overflow ([d4e42c6](https://github.com/molvqingtai/WebChat/commit/d4e42c68caf8e2e080854f244328c1e519ed6338))

## [1.2.1](https://github.com/molvqingtai/WebChat/compare/v1.2.0...v1.2.1) (2024-10-10)

### Bug Fixes

- avatar is not displayed completely ([de97d05](https://github.com/molvqingtai/WebChat/commit/de97d0552894a33f2b15dd232598c40335d941a4))
- the text in the button is not visible in dark mode ([d6652cb](https://github.com/molvqingtai/WebChat/commit/d6652cb2a43116016af32697b52d5bba276e6d2c))
- the text in the textarea is not visible in dark mode ([d75a191](https://github.com/molvqingtai/WebChat/commit/d75a191dedd40a02fc58707ac60cccd9ff020c5f))

### Performance Improvements

- change https://github.com/weizhenye/Danmaku to https://github.com/imtaotao/danmu ([05ee49e](https://github.com/molvqingtai/WebChat/commit/05ee49e7c4019f32c654f2f935b734ec2383bebc))
- submit store flow ([5235a6e](https://github.com/molvqingtai/WebChat/commit/5235a6ee8703597df227942208b4075bff880c2d))

# [1.2.0](https://github.com/molvqingtai/WebChat/compare/v1.1.6...v1.2.0) (2024-10-08)

### Features

- support display of online user list ([4c7137d](https://github.com/molvqingtai/WebChat/commit/4c7137d045a127bef6e8a3afe319f15a480b149c))

## [1.1.6](https://github.com/molvqingtai/WebChat/compare/v1.1.5...v1.1.6) (2024-10-04)

### Bug Fixes

- it should not be sent when composing ([8ee9ed6](https://github.com/molvqingtai/WebChat/commit/8ee9ed6259f731fa43ef0d458a7e040ad1618d12))

## [1.1.5](https://github.com/molvqingtai/WebChat/compare/v1.1.4...v1.1.5) (2024-10-02)

### Bug Fixes

- multiple tabs display duplicate online users ([8b843ac](https://github.com/molvqingtai/WebChat/commit/8b843ac45cc415676641b66dbfb21329c3f7c962))

## [1.1.4](https://github.com/molvqingtai/WebChat/compare/v1.1.3...v1.1.4) (2024-10-02)

### Bug Fixes

- firfox requestAnimationFrame error ([65bf9b2](https://github.com/molvqingtai/WebChat/commit/65bf9b2419ec65b6c53355986df9a0e2eb593d6f))

## [1.1.3](https://github.com/molvqingtai/WebChat/compare/v1.1.2...v1.1.3) (2024-10-02)

### Performance Improvements

- add version link ([4551ad2](https://github.com/molvqingtai/WebChat/commit/4551ad2964e21e1bf85866b79acd25bf556aa26d))

## [1.1.2](https://github.com/molvqingtai/WebChat/compare/v1.1.1...v1.1.2) (2024-10-02)

### Performance Improvements

- support unread status ([1f44af8](https://github.com/molvqingtai/WebChat/commit/1f44af873c57aaed2eb3d845342ad427ce1d8a4f))

## [1.1.1](https://github.com/molvqingtai/WebChat/compare/v1.1.0...v1.1.1) (2024-10-01)

### Performance Improvements

- a tag use Link component ([fce64b7](https://github.com/molvqingtai/WebChat/commit/fce64b744c2ada3532ff3d4b78d08559c718ca1a))

# [1.1.0](https://github.com/molvqingtai/WebChat/compare/v1.0.29...v1.1.0) (2024-09-30)

### Features

- support danmaku ([999a55c](https://github.com/molvqingtai/WebChat/commit/999a55c65f78d0a1a0938c354a8453f2aa39fcd0))

## [1.0.29](https://github.com/molvqingtai/WebChat/compare/v1.0.28...v1.0.29) (2024-09-29)

### Bug Fixes

- compile by environment ([52cd203](https://github.com/molvqingtai/WebChat/commit/52cd203a53ec10dda48572659d0e9959667575be))
- error when leaving the room without joining ([8476595](https://github.com/molvqingtai/WebChat/commit/8476595011c0e38929e6ebaa44ab7d8d5292a8e3))

## [1.0.28](https://github.com/molvqingtai/WebChat/compare/v1.0.27...v1.0.28) (2024-09-28)

### Bug Fixes

- svg icon size ([089d69a](https://github.com/molvqingtai/WebChat/commit/089d69a095c22ea24bd2e8960799d7f2acb0b1ac))

## [1.0.27](https://github.com/molvqingtai/WebChat/compare/v1.0.26...v1.0.27) (2024-09-28)

### Bug Fixes

- uniformly resizable size ([3bb2b55](https://github.com/molvqingtai/WebChat/commit/3bb2b55f21e2ead16be4f7c4d9aa40cee87cca93))

### Performance Improvements

- add isolate events ([8fd5f04](https://github.com/molvqingtai/WebChat/commit/8fd5f04ecd730bf4bc73fe72c1ce9281a572ca4c))

## [1.0.26](https://github.com/molvqingtai/WebChat/compare/v1.0.25...v1.0.26) (2024-09-28)

### Bug Fixes

- release flow ([e0f4a3f](https://github.com/molvqingtai/WebChat/commit/e0f4a3f18adc4452ec0732bbfdc0a240d203a0e7))
- release flow ([aa0088b](https://github.com/molvqingtai/WebChat/commit/aa0088bbc909c1c7b4745673978802e3016fde13))

## [1.0.25](https://github.com/molvqingtai/WebChat/compare/v1.0.24...v1.0.25) (2024-09-28)

### Bug Fixes

- test release flow ([b10e9db](https://github.com/molvqingtai/WebChat/commit/b10e9dbb8288af9fe976e3d65ed2ea38530bdbcc))

## [1.0.24](https://github.com/molvqingtai/WebChat/compare/v1.0.23...v1.0.24) (2024-09-28)

### Bug Fixes

- test release flow ([b4fe712](https://github.com/molvqingtai/WebChat/commit/b4fe7128250210012ae55b3209107362dcbb2df8))

## [1.0.23](https://github.com/molvqingtai/WebChat/compare/v1.0.22...v1.0.23) (2024-09-28)

### Bug Fixes

- test release flow ([3d984fc](https://github.com/molvqingtai/WebChat/commit/3d984fc42bc3581723fe29ece360a9ee842026c3))

## [1.0.22](https://github.com/molvqingtai/WebChat/compare/v1.0.21...v1.0.22) (2024-09-28)

### Bug Fixes

- test release flow ([72137e8](https://github.com/molvqingtai/WebChat/commit/72137e811d07459fbd0859e114c22c515a5d6e26))

## [1.0.21](https://github.com/molvqingtai/WebChat/compare/v1.0.20...v1.0.21) (2024-09-28)

### Bug Fixes

- test release flow ([444d24c](https://github.com/molvqingtai/WebChat/commit/444d24c3b923d184da55a22cd165cb33a8751908))

## [1.0.20](https://github.com/molvqingtai/WebChat/compare/v1.0.19...v1.0.20) (2024-09-28)

### Bug Fixes

- test release flow ([16c29e6](https://github.com/molvqingtai/WebChat/commit/16c29e6805001450e165d3db37991bda9619305f))

## [1.0.19](https://github.com/molvqingtai/WebChat/compare/v1.0.18...v1.0.19) (2024-09-28)

### Bug Fixes

- test release flow ([7b543bc](https://github.com/molvqingtai/WebChat/commit/7b543bc4f354fc3a1483d3eed5d60bc235a4953f))

## [1.0.18](https://github.com/molvqingtai/WebChat/compare/v1.0.17...v1.0.18) (2024-09-28)

### Bug Fixes

- test release flow ([f4fb1f7](https://github.com/molvqingtai/WebChat/commit/f4fb1f7c3a6180a7183659fa523e634f47ae9738))

## [1.0.17](https://github.com/molvqingtai/WebChat/compare/v1.0.16...v1.0.17) (2024-09-28)

### Bug Fixes

- release flow ([ffa8d42](https://github.com/molvqingtai/WebChat/commit/ffa8d4233ba55d623d9870e70c952d3b176c25db))
- release flow ([5c043a2](https://github.com/molvqingtai/WebChat/commit/5c043a22d2ff4064d932a1d9df4a1c9b23365528))

## [1.0.16](https://github.com/molvqingtai/WebChat/compare/v1.0.15...v1.0.16) (2024-09-28)

### Bug Fixes

- test release flow ([2a77a6f](https://github.com/molvqingtai/WebChat/commit/2a77a6ff94831f7dda116a2d55182980cb56a03b))
- test release flow ([e851939](https://github.com/molvqingtai/WebChat/commit/e8519393b64377609f8889fe665b2ef17ded1198))

## [1.0.4](https://github.com/molvqingtai/WebChat/compare/v1.0.3...v1.0.4) (2024-09-27)

### Bug Fixes

- add .zip to assets ([273f1a3](https://github.com/molvqingtai/WebChat/commit/273f1a33deb5c8e84aa4c2540a41127f4e41b166))

## [1.0.3](https://github.com/molvqingtai/WebChat/compare/v1.0.2...v1.0.3) (2024-09-27)

### Bug Fixes

- add packge.json & .zip to assets ([8c01312](https://github.com/molvqingtai/WebChat/commit/8c01312ecb5fa2c27340f123316df112b67e8582))

## [1.0.2](https://github.com/molvqingtai/WebChat/compare/v1.0.1...v1.0.2) (2024-09-27)

### Bug Fixes

- add packge.json to assets ([528b4fd](https://github.com/molvqingtai/WebChat/commit/528b4fd452fb14974e218b65ac4588c351dd72e4))

## [1.0.1](https://github.com/molvqingtai/WebChat/compare/v1.0.0...v1.0.1) (2024-09-27)

### Bug Fixes

- add packge.json to assets ([974b440](https://github.com/molvqingtai/WebChat/commit/974b4407520c10b745abcab031898476477dee27))

# 1.0.0 (2024-09-27)

### Bug Fixes

- "use px units to fix small font-size in some websites root elements ([1e904f1](https://github.com/molvqingtai/WebChat/commit/1e904f12d791cc030d175cbc35bdee61b8237764))
- **css:** prevent some styles from being inherited from the app ([1a8d2ec](https://github.com/molvqingtai/WebChat/commit/1a8d2ec675d53eb2dc3641e52c8e0b1054b1b93f))
- hasItemQuery not use get ([15821ea](https://github.com/molvqingtai/WebChat/commit/15821eaa47203178accf7634ebf8af1ca0d33de0))
- mesage time update ([90253ef](https://github.com/molvqingtai/WebChat/commit/90253effa616ea0b991f69cd01e7c9eba942645e))
- message may not exist ([59af3db](https://github.com/molvqingtai/WebChat/commit/59af3db87e5ae4d9bae621f0020f90238ae7c7ff))
- messageId not found ([bb9eccd](https://github.com/molvqingtai/WebChat/commit/bb9eccd31c67f0c921d1bd27aec1b9809a2970c6))
- **options:** fix meteors overflow ([c7a3f3f](https://github.com/molvqingtai/WebChat/commit/c7a3f3f150dd7af8c5394ba11323fd6addf2481d))
- **setup:** setup page display timing is incorrect ([f6277bc](https://github.com/molvqingtai/WebChat/commit/f6277bcc83d8306c5ca9c8fc269cea6b7760c004))
- **userInfo:** fixed infinite loop sync in firefox ([9fca355](https://github.com/molvqingtai/WebChat/commit/9fca355c99cacca116904a6b31f3e953d8a567ba))

### Features

- add setup page ([578c79c](https://github.com/molvqingtai/WebChat/commit/578c79cec3da369ba9949d1f76d1d6f9540f1e79))
- auto-growing Textarea ([98268ce](https://github.com/molvqingtai/WebChat/commit/98268ce09f82b9cbb096e94f28c9c13f30b66301))
- implement join and leave prompts ([ec62b11](https://github.com/molvqingtai/WebChat/commit/ec62b1155e4d1d66c9487db41eff1ebac79c199a))
- message list implements virtual scrolling ([c9388c7](https://github.com/molvqingtai/WebChat/commit/c9388c744e554a89b1d784c8475fd775207cd806))
- peer message working! ([6fb4035](https://github.com/molvqingtai/WebChat/commit/6fb4035ac34a1b64762237a60455612ac1e2a5bf))
- **setup:** user and message sync ([cc3424d](https://github.com/molvqingtai/WebChat/commit/cc3424d4d8203fd09d5412f8498d143bf4283ede))
- store message records ([c029423](https://github.com/molvqingtai/WebChat/commit/c029423bf9e553cd9000f547f6c7cd28da05896e))
- use ualy avatar ([89e20a6](https://github.com/molvqingtai/WebChat/commit/89e20a65db3cdb8e24bad34c5002a25ffd128c47))

### Performance Improvements

- adapt to small screen ([c9b60fc](https://github.com/molvqingtai/WebChat/commit/c9b60fc6d4af83903cbe6bcc4621e5c081417d3f))
- add animation effects and add self join message ([437c234](https://github.com/molvqingtai/WebChat/commit/437c234f8a7ba1e02c04cc60bddafd59436a33fd))
- add custom scroll bars to scrollable content ([d3fa441](https://github.com/molvqingtai/WebChat/commit/d3fa4418463d47cfe9164086bc00a86ce624b7d7))
- add github link ([7fb24a6](https://github.com/molvqingtai/WebChat/commit/7fb24a68990bb37a15ad01f0f97c7b18a148c20c))
- app show hide toggle ([ca1ea11](https://github.com/molvqingtai/WebChat/commit/ca1ea11dcbcd1f090f23282127b934afce25fa1c))
- **AppContainer:** dynamic width ([3d45e46](https://github.com/molvqingtai/WebChat/commit/3d45e4609c136a98e9994d0c04f64a8d89cb6442))
- custom toast style ([f36ae70](https://github.com/molvqingtai/WebChat/commit/f36ae70146736533ef1178af2ac11402cf957b37))
- **message:** user name ellipsis ([8a18871](https://github.com/molvqingtai/WebChat/commit/8a18871b90a59ce6e958d600de5993d83c85d322))
- multiple peerRoom implementation ([e373993](https://github.com/molvqingtai/WebChat/commit/e37399389974384634089dfe301973e9deea99a0))
- multiple Tab for the same user lead to duplicate joining issues ([4205868](https://github.com/molvqingtai/WebChat/commit/420586839ac6e6192caa258b271da948b5f80992))
- optimize avatar display ([9d3a1d8](https://github.com/molvqingtai/WebChat/commit/9d3a1d81cdb9df048b0b3c81ff7b091a79891ac7))
- optimize style and update deps ([e9e73bd](https://github.com/molvqingtai/WebChat/commit/e9e73bd128d85da08a628e2044e0bdf7b40ebc0a))
- **options:** add meteors effect ([ac165af](https://github.com/molvqingtai/WebChat/commit/ac165af833c6797d629afd70117f930a25673778))
- remove callbackToObserve ([415b9f5](https://github.com/molvqingtai/WebChat/commit/415b9f507ee9268e11d1e98d8dcb5e22b6f594d3))
