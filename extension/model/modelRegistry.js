/* eslint-disable no-unused-vars */
/* eslint-disable max-lines */

let modelRegistryRootURL = "https://storage.googleapis.com/bergamot-models-sandbox/0.2.12";
const modelRegistryRootURLTest = "https://example.com/browser/browser/extensions/translations/test/browser";

const modelRegistry = {
  enit: {
    vocab: {
      name: "vocab.enit.spm",
      size: 814128,
      estimatedCompressedSize: 405338,
      expectedSha256Hash:
        "de8cbeb79e0139304bfa47e8559f2447016bf9906225a97d3df1baed4de8f3a3",
    },
    lex: {
      name: "lex.50.50.enit.s2t.bin",
      size: 4489920,
      estimatedCompressedSize: 2409986,
      expectedSha256Hash:
        "bb1fad3b3f6a13ebce1698cf7f39ca736c4dea4525f3dab5e1a78436f07445e6",
    },
    model: {
      name: "model.enit.intgemm.alphas.bin",
      size: 17140836,
      estimatedCompressedSize: 13283223,
      expectedSha256Hash:
        "a5ce3723f62ead92a0e0373b6df0ad8e3e6d22963adb1333984206e33b8b6c61",
    },
  },
  enpt: {
    vocab: {
      name: "vocab.enpt.spm",
      size: 812781,
      estimatedCompressedSize: 406524,
      expectedSha256Hash:
        "633a3d782c79f7d5e4b94ab96848f47c2fdf8ba82dd99efd1742b8a696bbd0cc",
    },
    lex: {
      name: "lex.50.50.enpt.s2t.bin",
      size: 4472528,
      estimatedCompressedSize: 2411984,
      expectedSha256Hash:
        "1e96599123d275afa37353dfe84677a4070f013494fbdc9c52a28445cc9bc38d",
    },
    model: {
      name: "model.enpt.intgemm.alphas.bin",
      size: 17140836,
      estimatedCompressedSize: 13429592,
      expectedSha256Hash:
        "d968735704c75e33c2e183b9241f14c0b2a560d01d88a2728e5c0119a4d7fb22",
    },
  },
  enru: {
    vocab: {
      name: "vocab.enru.spm",
      size: 937157,
      estimatedCompressedSize: 435776,
      expectedSha256Hash:
        "feca2d44f01b946c85faba3b15b5eb53344bec84cd14a1a4d4a82ddd774c5edd",
    },
    lex: {
      name: "lex.50.50.enru.s2t.bin",
      size: 3049096,
      estimatedCompressedSize: 1579779,
      expectedSha256Hash:
        "7bd3e2c0a72286fe1f3da65c56c49a7cd77efa5f1d1a444e2a9e769480b96ff3",
    },
    model: {
      name: "model.enru.intgemm.alphas.bin",
      size: 17140836,
      estimatedCompressedSize: 12853987,
      expectedSha256Hash:
        "4a45186a93b8a2dd9301c66a3b3dad580b1bcfa74aadda583ca383f9fe0dea93",
    },
  },
  iten: {
    vocab: {
      name: "vocab.iten.spm",
      size: 814151,
      estimatedCompressedSize: 405416,
      expectedSha256Hash:
        "22d5ce6973be5360a921103acbe984a9bfca952a1f6c55c9cb5ef7de4fd58266",
    },
    lex: {
      name: "lex.50.50.iten.s2t.bin",
      size: 5238420,
      estimatedCompressedSize: 2860178,
      expectedSha256Hash:
        "357d362373022b029ee9965975a133e6f36fdb0fed749202ff578365cf0111f8",
    },
    model: {
      name: "model.iten.intgemm.alphas.bin",
      size: 17140836,
      estimatedCompressedSize: 13423308,
      expectedSha256Hash:
        "1fae546faeb9046f80b1b7e940b37b660974ce72902778181d6cd1c30b717f35",
    },
  },
  pten: {
    vocab: {
      name: "vocab.pten.spm",
      size: 812889,
      estimatedCompressedSize: 406730,
      expectedSha256Hash:
        "8389979e3c965688b07aeb712a7e44406e5dcdb2b84087229d26fcc71448c4ed",
    },
    lex: {
      name: "lex.50.50.pten.s2t.bin",
      size: 5001420,
      estimatedCompressedSize: 2733800,
      expectedSha256Hash:
        "212ed0ae44a6f920cd6d17ca02f0a523ba6c4b0ef5078ae310c20bc4c51484c5",
    },
    model: {
      name: "model.pten.intgemm.alphas.bin",
      size: 17140836,
      estimatedCompressedSize: 13584764,
      expectedSha256Hash:
        "6c3b7af01772022a19712410c63342ba581468c2f1aac34d7488409c4043e697",
    },
  },
  ruen: {
    vocab: {
      name: "vocab.ruen.spm",
      size: 936576,
      estimatedCompressedSize: 435801,
      expectedSha256Hash:
        "aaf9a325c0a988c507d0312cb6ba1a02bac7a370bcd879aedee626a40bfbda78",
    },
    lex: {
      name: "lex.50.50.ruen.s2t.bin",
      size: 5090836,
      estimatedCompressedSize: 2684919,
      expectedSha256Hash:
        "e6667e22f5f86be4872e3768b7184727f5dd8c9f2ccfb0639baabcb1176f5d11",
    },
    model: {
      name: "model.ruen.intgemm.alphas.bin",
      size: 17140836,
      estimatedCompressedSize: 13108893,
      expectedSha256Hash:
        "3b6a0305e3d232fadd54f5a765365b7b96ad6d8f2e818cba594b02fbd8fadb3d",
    },
  },
  csen: {
    vocab: {
      name: "vocab.csen.spm",
      size: 769763,
      estimatedCompressedSize: 366392,
      expectedSha256Hash:
        "f71cc5d045e479607078e079884f44032f5a0b82547fb96eefa29cd1eb47c6f3",
    },
    lex: {
      name: "lex.50.50.csen.s2t.bin",
      size: 4535788,
      estimatedCompressedSize: 2418488,
      expectedSha256Hash:
        "8228a3c3f7887759a62b7d7c674a7bef9b70161913f9b0939ab58f71186835c2",
    },
    model: {
      name: "model.csen.intgemm.alphas.bin",
      size: 17140756,
      estimatedCompressedSize: 13045032,
      expectedSha256Hash:
        "5b16661e2864dc50b2f4091a16bdd4ec8d8283e04271e602159ba348df5d6e2d",
    },
  },
  deen: {
    vocab: {
      name: "vocab.deen.spm",
      size: 784269,
      estimatedCompressedSize: 410738,
      expectedSha256Hash:
        "417668f2ed297970febafb5b079a9d5ebc4ed0b3550ac8386d67a90473a09bd7",
    },
    lex: {
      name: "lex.50.50.deen.s2t.bin",
      size: 5047568,
      estimatedCompressedSize: 2657472,
      expectedSha256Hash:
        "2f7c0f7bbce97ae5b52454074a892ba7b7610fb98e3c5d341e4ca79f0850c4de",
    },
    model: {
      name: "model.deen.intgemm.alphas.bin",
      size: 17140837,
      estimatedCompressedSize: 12995752,
      expectedSha256Hash:
        "1980225d00dc5645491777accff5b3c9d20b92eff67a25135f1cf8fe2ed8fb8f",
    },
  },
  encs: {
    vocab: {
      name: "vocab.csen.spm",
      size: 769763,
      estimatedCompressedSize: 366392,
      expectedSha256Hash:
        "f71cc5d045e479607078e079884f44032f5a0b82547fb96eefa29cd1eb47c6f3",
    },
    lex: {
      name: "lex.50.50.encs.s2t.bin",
      size: 3556124,
      estimatedCompressedSize: 1913246,
      expectedSha256Hash:
        "e19c77231bf977988e31ff8db15fe79966b5170564bd3e10613f239e7f461d97",
    },
    model: {
      name: "model.encs.intgemm.alphas.bin",
      size: 17140756,
      estimatedCompressedSize: 12630325,
      expectedSha256Hash:
        "9a2fe0588bd972accfc801e2f31c945de0557804a91666ae5ab43b94fb74ac4b",
    },
  },
  ende: {
    vocab: {
      name: "vocab.deen.spm",
      size: 784269,
      estimatedCompressedSize: 410171,
      expectedSha256Hash:
        "417668f2ed297970febafb5b079a9d5ebc4ed0b3550ac8386d67a90473a09bd7",
    },
    lex: {
      name: "lex.50.50.ende.s2t.bin",
      size: 3943644,
      estimatedCompressedSize: 2113181,
      expectedSha256Hash:
        "f03eb8245042feb7a5800815b8d0dc215d7a60691632405b65c461d250cedbe6",
    },
    model: {
      name: "model.ende.intgemm.alphas.bin",
      size: 17140835,
      estimatedCompressedSize: 12768493,
      expectedSha256Hash:
        "b3e980d6602ab0bdfe8d9315cb5fc282a16bb1c8dccf38e70945c584551c4318",
    },
  },
  enes: {
    vocab: {
      name: "vocab.esen.spm",
      size: 825463,
      estimatedCompressedSize: 414566,
      expectedSha256Hash:
        "909b1eea1face0d7f90a474fe29a8c0fef8d104b6e41e65616f864c964ba8845",
    },
    lex: {
      name: "lex.50.50.enes.s2t.bin",
      size: 3347104,
      estimatedCompressedSize: 1720700,
      expectedSha256Hash:
        "3a113d713dec3cf1d12bba5b138ae616e28bba4bbc7fe7fd39ba145e26b86d7f",
    },
    model: {
      name: "model.enes.intgemm.alphas.bin",
      size: 17140755,
      estimatedCompressedSize: 12602853,
      expectedSha256Hash:
        "fa7460037a3163e03fe1d23602f964bff2331da6ee813637e092ddf37156ef53",
    },
  },
  enet: {
    vocab: {
      name: "vocab.eten.spm",
      size: 828426,
      estimatedCompressedSize: 416995,
      expectedSha256Hash:
        "e3b66bc141f6123cd40746e2fb9b8ee4f89cbf324ab27d6bbf3782e52f15fa2d",
    },
    lex: {
      name: "lex.50.50.enet.s2t.bin",
      size: 2700780,
      estimatedCompressedSize: 1336443,
      expectedSha256Hash:
        "3d1b40ff43ebef82cf98d416a88a1ea19eb325a85785eef102f59878a63a829d",
    },
    model: {
      name: "model.enet.intgemm.alphas.bin",
      size: 17140754,
      estimatedCompressedSize: 12543318,
      expectedSha256Hash:
        "a28874a8b702a519a14dc71bcee726a5cb4b539eeaada2d06492f751469a1fd6",
    },
  },
  esen: {
    vocab: {
      name: "vocab.esen.spm",
      size: 825463,
      estimatedCompressedSize: 414566,
      expectedSha256Hash:
        "909b1eea1face0d7f90a474fe29a8c0fef8d104b6e41e65616f864c964ba8845",
    },
    lex: {
      name: "lex.50.50.esen.s2t.bin",
      size: 3860888,
      estimatedCompressedSize: 1978538,
      expectedSha256Hash:
        "f11a2c23ef85ab1fee1c412b908d69bc20d66fd59faa8f7da5a5f0347eddf969",
    },
    model: {
      name: "model.esen.intgemm.alphas.bin",
      size: 17140755,
      estimatedCompressedSize: 13215960,
      expectedSha256Hash:
        "4b6b7f451094aaa447d012658af158ffc708fc8842dde2f871a58404f5457fe0",
    },
  },
  eten: {
    vocab: {
      name: "vocab.eten.spm",
      size: 828426,
      estimatedCompressedSize: 416995,
      expectedSha256Hash:
          "e3b66bc141f6123cd40746e2fb9b8ee4f89cbf324ab27d6bbf3782e52f15fa2d",
    },
    lex: {
      name: "lex.50.50.eten.s2t.bin",
      size: 3974944,
      estimatedCompressedSize: 1920655,
      expectedSha256Hash:
          "6992bedc590e60e610a28129c80746fe5f33144a4520e2c5508d87db14ca54f8",
    },
    model: {
      name: "model.eten.intgemm.alphas.bin",
      size: 17140754,
      estimatedCompressedSize: 12222624,
      expectedSha256Hash:
          "aac98a2371e216ee2d4843cbe896c617f6687501e17225ac83482eba52fd0028",
    },
  },
  bgen: {
    vocab: {
      name: "vocab.bgen.spm",
      size: 920621,
      estimatedCompressedSize: 435213,
      expectedSha256Hash:
        "24ce87ba39216714f222ca6a105f30b1863a7ef8b58c9fafdc7a66184e9813a5",
    },
    lex: {
      name: "lex.50.50.bgen.s2t.bin",
      size: 6182512,
      estimatedCompressedSize: 3272580,
      expectedSha256Hash:
        "71e8d040a2f63705bec232cd186f32e9f9a78e7968216516c4535589f6a828f9",
    },
    model: {
      name: "model.bgen.intgemm.alphas.bin",
      size: 17140899,
      estimatedCompressedSize: 13167979,
      expectedSha256Hash:
        "71900847a98cf66bd1d05eaafc23a794c8c1285fb3f0e2ecd2849e6f81c79d53",
    },
  },
  enbg: {
    vocab: {
      name: "vocab.bgen.spm",
      size: 919745,
      estimatedCompressedSize: 435044,
      expectedSha256Hash:
        "b14e44beb653db924c826e1696bcfab23ca9fd3e479baf8bea67d0be77432192",
    },
    lex: {
      name: "lex.50.50.enbg.s2t.bin",
      size: 5607608,
      estimatedCompressedSize: 2950444,
      expectedSha256Hash:
        "0f9b794b6f8a9c4b5b781fde49391852b398184b730f89a09428cf562e8bede6",
    },
    model: {
      name: "model.enbg.intgemm.alphas.bin",
      size: 17140899,
      estimatedCompressedSize: 13311038,
      expectedSha256Hash:
        "02715a7a81a610a37439d4f788a6f3efcc1ecb39618bc4184442a39378907dfe",
    },
  },
};