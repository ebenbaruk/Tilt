/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/tilt.json`.
 */
export type Tilt = {
  "address": "2css9q2M2SH4ekVjLYs9dfnEQpsxMprrYUrM2hWzVokd",
  "metadata": {
    "name": "tilt",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Tilt on-chain casino: games, VRF draws and USDC vault, played in a MagicBlock Ephemeral Rollup"
  },
  "instructions": [
    {
      "name": "applyCheckpoint",
      "discriminator": [
        199,
        137,
        238,
        158,
        82,
        12,
        102,
        179
      ],
      "accounts": [
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "account",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "ledger.player",
                "account": "ledger"
              }
            ]
          }
        },
        {
          "name": "ledger",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  101,
                  100,
                  103,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "ledger.player",
                "account": "ledger"
              }
            ]
          }
        },
        {
          "name": "thisProgram",
          "address": "2css9q2M2SH4ekVjLYs9dfnEQpsxMprrYUrM2hWzVokd"
        },
        {
          "name": "escrowAuth"
        },
        {
          "name": "escrow",
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "baccaratDeal",
      "discriminator": [
        40,
        20,
        44,
        145,
        43,
        203,
        183,
        91
      ],
      "accounts": [
        {
          "name": "vault",
          "docs": [
            "Read-only copy of the Solana vault: relayer key and limits."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "payer",
          "docs": [
            "The Tilt relay, acting on the player's intents."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "account",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "account.player",
                "account": "playerAccount"
              }
            ]
          }
        },
        {
          "name": "ledger",
          "docs": [
            "Read-only copy of the Solana ledger, to credit new deposits."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  101,
                  100,
                  103,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "account.player",
                "account": "playerAccount"
              }
            ]
          }
        },
        {
          "name": "table",
          "docs": [
            "The player's blackjack table: required by blackjack rounds, omitted (program id)",
            "by the other games."
          ],
          "writable": true,
          "optional": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  106,
                  116,
                  97,
                  98,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "account.player",
                "account": "playerAccount"
              }
            ]
          }
        },
        {
          "name": "oracleQueue",
          "writable": true
        },
        {
          "name": "programIdentity",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  100,
                  101,
                  110,
                  116,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "vrfProgram",
          "address": "Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz"
        },
        {
          "name": "slotHashes",
          "address": "SysvarS1otHashes111111111111111111111111111"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "bet",
          "type": {
            "defined": {
              "name": "baccaratBet"
            }
          }
        },
        {
          "name": "clientSeed",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "blackjackBet",
      "discriminator": [
        74,
        68,
        244,
        118,
        202,
        117,
        58,
        145
      ],
      "accounts": [
        {
          "name": "vault",
          "docs": [
            "Read-only copy of the Solana vault: relayer key and limits."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "payer",
          "docs": [
            "The Tilt relay, acting on the player's intents."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "account",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "account.player",
                "account": "playerAccount"
              }
            ]
          }
        },
        {
          "name": "ledger",
          "docs": [
            "Read-only copy of the Solana ledger, to credit new deposits."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  101,
                  100,
                  103,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "account.player",
                "account": "playerAccount"
              }
            ]
          }
        },
        {
          "name": "table",
          "docs": [
            "The player's blackjack table: required by blackjack rounds, omitted (program id)",
            "by the other games."
          ],
          "writable": true,
          "optional": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  106,
                  116,
                  97,
                  98,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "account.player",
                "account": "playerAccount"
              }
            ]
          }
        },
        {
          "name": "oracleQueue",
          "writable": true
        },
        {
          "name": "programIdentity",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  100,
                  101,
                  110,
                  116,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "vrfProgram",
          "address": "Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz"
        },
        {
          "name": "slotHashes",
          "address": "SysvarS1otHashes111111111111111111111111111"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "hands",
          "type": "u8"
        },
        {
          "name": "clientSeed",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "blackjackDouble",
      "discriminator": [
        238,
        68,
        12,
        45,
        222,
        31,
        58,
        164
      ],
      "accounts": [
        {
          "name": "vault",
          "docs": [
            "Read-only copy of the Solana vault: relayer key and limits."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "payer",
          "docs": [
            "The Tilt relay, acting on the player's intents."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "account",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "account.player",
                "account": "playerAccount"
              }
            ]
          }
        },
        {
          "name": "ledger",
          "docs": [
            "Read-only copy of the Solana ledger, to credit new deposits."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  101,
                  100,
                  103,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "account.player",
                "account": "playerAccount"
              }
            ]
          }
        },
        {
          "name": "table",
          "docs": [
            "The player's blackjack table: required by blackjack rounds, omitted (program id)",
            "by the other games."
          ],
          "writable": true,
          "optional": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  106,
                  116,
                  97,
                  98,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "account.player",
                "account": "playerAccount"
              }
            ]
          }
        },
        {
          "name": "oracleQueue",
          "writable": true
        },
        {
          "name": "programIdentity",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  100,
                  101,
                  110,
                  116,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "vrfProgram",
          "address": "Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz"
        },
        {
          "name": "slotHashes",
          "address": "SysvarS1otHashes111111111111111111111111111"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "clientSeed",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "blackjackHit",
      "discriminator": [
        219,
        32,
        34,
        65,
        115,
        127,
        19,
        126
      ],
      "accounts": [
        {
          "name": "vault",
          "docs": [
            "Read-only copy of the Solana vault: relayer key and limits."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "payer",
          "docs": [
            "The Tilt relay, acting on the player's intents."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "account",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "account.player",
                "account": "playerAccount"
              }
            ]
          }
        },
        {
          "name": "ledger",
          "docs": [
            "Read-only copy of the Solana ledger, to credit new deposits."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  101,
                  100,
                  103,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "account.player",
                "account": "playerAccount"
              }
            ]
          }
        },
        {
          "name": "table",
          "docs": [
            "The player's blackjack table: required by blackjack rounds, omitted (program id)",
            "by the other games."
          ],
          "writable": true,
          "optional": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  106,
                  116,
                  97,
                  98,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "account.player",
                "account": "playerAccount"
              }
            ]
          }
        },
        {
          "name": "oracleQueue",
          "writable": true
        },
        {
          "name": "programIdentity",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  100,
                  101,
                  110,
                  116,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "vrfProgram",
          "address": "Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz"
        },
        {
          "name": "slotHashes",
          "address": "SysvarS1otHashes111111111111111111111111111"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "clientSeed",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "blackjackSplit",
      "discriminator": [
        17,
        28,
        32,
        211,
        146,
        46,
        208,
        41
      ],
      "accounts": [
        {
          "name": "vault",
          "docs": [
            "Read-only copy of the Solana vault: relayer key and limits."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "payer",
          "docs": [
            "The Tilt relay, acting on the player's intents."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "account",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "account.player",
                "account": "playerAccount"
              }
            ]
          }
        },
        {
          "name": "ledger",
          "docs": [
            "Read-only copy of the Solana ledger, to credit new deposits."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  101,
                  100,
                  103,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "account.player",
                "account": "playerAccount"
              }
            ]
          }
        },
        {
          "name": "table",
          "docs": [
            "The player's blackjack table: required by blackjack rounds, omitted (program id)",
            "by the other games."
          ],
          "writable": true,
          "optional": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  106,
                  116,
                  97,
                  98,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "account.player",
                "account": "playerAccount"
              }
            ]
          }
        },
        {
          "name": "oracleQueue",
          "writable": true
        },
        {
          "name": "programIdentity",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  100,
                  101,
                  110,
                  116,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "vrfProgram",
          "address": "Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz"
        },
        {
          "name": "slotHashes",
          "address": "SysvarS1otHashes111111111111111111111111111"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "clientSeed",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "blackjackStand",
      "discriminator": [
        214,
        58,
        129,
        47,
        107,
        127,
        226,
        184
      ],
      "accounts": [
        {
          "name": "vault",
          "docs": [
            "Read-only copy of the Solana vault: relayer key and limits."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "payer",
          "docs": [
            "The Tilt relay, acting on the player's intents."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "account",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "account.player",
                "account": "playerAccount"
              }
            ]
          }
        },
        {
          "name": "ledger",
          "docs": [
            "Read-only copy of the Solana ledger, to credit new deposits."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  101,
                  100,
                  103,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "account.player",
                "account": "playerAccount"
              }
            ]
          }
        },
        {
          "name": "table",
          "docs": [
            "The player's blackjack table: required by blackjack rounds, omitted (program id)",
            "by the other games."
          ],
          "writable": true,
          "optional": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  106,
                  116,
                  97,
                  98,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "account.player",
                "account": "playerAccount"
              }
            ]
          }
        },
        {
          "name": "oracleQueue",
          "writable": true
        },
        {
          "name": "programIdentity",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  100,
                  101,
                  110,
                  116,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "vrfProgram",
          "address": "Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz"
        },
        {
          "name": "slotHashes",
          "address": "SysvarS1otHashes111111111111111111111111111"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "clientSeed",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "checkpoint",
      "discriminator": [
        213,
        200,
        19,
        204,
        240,
        143,
        184,
        252
      ],
      "accounts": [
        {
          "name": "vault",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "account",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "account.player",
                "account": "playerAccount"
              }
            ]
          }
        },
        {
          "name": "ledger",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  101,
                  100,
                  103,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "account.player",
                "account": "playerAccount"
              }
            ]
          }
        },
        {
          "name": "magicProgram",
          "address": "Magic11111111111111111111111111111111111111"
        },
        {
          "name": "magicContext",
          "writable": true,
          "address": "MagicContext1111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "consumeRandomness",
      "discriminator": [
        190,
        217,
        49,
        162,
        99,
        26,
        73,
        234
      ],
      "accounts": [
        {
          "name": "vrfProgramIdentity",
          "docs": [
            "Scoped VRF identity PDA, bound to this program. Its presence as a signer proves",
            "the callback was issued by the VRF program for this program."
          ],
          "signer": true
        },
        {
          "name": "account",
          "docs": [
            "Must be a player account PDA. The VRF program only calls back with the account the",
            "request named; this keeps the callback safe even if that ever changes."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "account.player",
                "account": "playerAccount"
              }
            ]
          }
        },
        {
          "name": "table",
          "docs": [
            "The player's table, for blackjack draws; the program id otherwise."
          ],
          "writable": true,
          "optional": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  106,
                  116,
                  97,
                  98,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "account.player",
                "account": "playerAccount"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "randomness",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "requestId",
          "type": "u64"
        }
      ]
    },
    {
      "name": "delegateAccount",
      "discriminator": [
        149,
        150,
        170,
        9,
        177,
        52,
        163,
        180
      ],
      "accounts": [
        {
          "name": "vault",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "player"
        },
        {
          "name": "ledger",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  101,
                  100,
                  103,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "player"
              }
            ]
          }
        },
        {
          "name": "bufferAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  117,
                  102,
                  102,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "account"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                24,
                12,
                135,
                51,
                234,
                253,
                132,
                42,
                23,
                91,
                143,
                100,
                117,
                247,
                92,
                216,
                69,
                90,
                227,
                83,
                114,
                248,
                108,
                194,
                137,
                171,
                145,
                243,
                105,
                204,
                132,
                234
              ]
            }
          }
        },
        {
          "name": "delegationRecordAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "account"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "delegationMetadataAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110,
                  45,
                  109,
                  101,
                  116,
                  97,
                  100,
                  97,
                  116,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "account"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "account",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "player"
              }
            ]
          }
        },
        {
          "name": "ownerProgram",
          "address": "2css9q2M2SH4ekVjLYs9dfnEQpsxMprrYUrM2hWzVokd"
        },
        {
          "name": "delegationProgram",
          "address": "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "delegateTable",
      "discriminator": [
        161,
        66,
        67,
        113,
        58,
        219,
        238,
        170
      ],
      "accounts": [
        {
          "name": "vault",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "player"
        },
        {
          "name": "bufferTable",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  117,
                  102,
                  102,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "table"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                24,
                12,
                135,
                51,
                234,
                253,
                132,
                42,
                23,
                91,
                143,
                100,
                117,
                247,
                92,
                216,
                69,
                90,
                227,
                83,
                114,
                248,
                108,
                194,
                137,
                171,
                145,
                243,
                105,
                204,
                132,
                234
              ]
            }
          }
        },
        {
          "name": "delegationRecordTable",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "table"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "delegationMetadataTable",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110,
                  45,
                  109,
                  101,
                  116,
                  97,
                  100,
                  97,
                  116,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "table"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "table",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  106,
                  116,
                  97,
                  98,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "player"
              }
            ]
          }
        },
        {
          "name": "ownerProgram",
          "address": "2css9q2M2SH4ekVjLYs9dfnEQpsxMprrYUrM2hWzVokd"
        },
        {
          "name": "delegationProgram",
          "address": "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "deposit",
      "discriminator": [
        242,
        35,
        198,
        137,
        82,
        225,
        242,
        182
      ],
      "accounts": [
        {
          "name": "player",
          "signer": true
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "vaultToken",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  116,
                  111,
                  107,
                  101,
                  110
                ]
              }
            ]
          }
        },
        {
          "name": "playerToken",
          "writable": true
        },
        {
          "name": "mint",
          "relations": [
            "vault"
          ]
        },
        {
          "name": "ledger",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  101,
                  100,
                  103,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "player"
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "expireRound",
      "discriminator": [
        238,
        222,
        71,
        141,
        104,
        222,
        76,
        248
      ],
      "accounts": [
        {
          "name": "vault",
          "docs": [
            "Read-only copy of the Solana vault: relayer key and limits."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "payer",
          "docs": [
            "The Tilt relay, acting on the player's intents."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "account",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "account.player",
                "account": "playerAccount"
              }
            ]
          }
        },
        {
          "name": "ledger",
          "docs": [
            "Read-only copy of the Solana ledger, to credit new deposits."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  101,
                  100,
                  103,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "account.player",
                "account": "playerAccount"
              }
            ]
          }
        },
        {
          "name": "table",
          "docs": [
            "The player's blackjack table: required by blackjack rounds, omitted (program id)",
            "by the other games."
          ],
          "writable": true,
          "optional": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  106,
                  116,
                  97,
                  98,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "account.player",
                "account": "playerAccount"
              }
            ]
          }
        },
        {
          "name": "oracleQueue",
          "writable": true
        },
        {
          "name": "programIdentity",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  100,
                  101,
                  110,
                  116,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "vrfProgram",
          "address": "Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz"
        },
        {
          "name": "slotHashes",
          "address": "SysvarS1otHashes111111111111111111111111111"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "clientSeed",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "fundPromo",
      "discriminator": [
        23,
        227,
        240,
        194,
        141,
        246,
        217,
        55
      ],
      "accounts": [
        {
          "name": "funder",
          "signer": true
        },
        {
          "name": "vault",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "promo",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  109,
                  111
                ]
              }
            ]
          }
        },
        {
          "name": "promoToken",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  109,
                  111,
                  95,
                  116,
                  111,
                  107,
                  101,
                  110
                ]
              }
            ]
          }
        },
        {
          "name": "source",
          "writable": true
        },
        {
          "name": "mint",
          "relations": [
            "vault"
          ]
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "fundVault",
      "discriminator": [
        26,
        33,
        207,
        242,
        119,
        108,
        134,
        73
      ],
      "accounts": [
        {
          "name": "funder",
          "signer": true
        },
        {
          "name": "vault",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "vaultToken",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  116,
                  111,
                  107,
                  101,
                  110
                ]
              }
            ]
          }
        },
        {
          "name": "source",
          "writable": true
        },
        {
          "name": "mint",
          "relations": [
            "vault"
          ]
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "initPromo",
      "discriminator": [
        11,
        158,
        221,
        133,
        205,
        73,
        242,
        182
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true,
          "relations": [
            "vault"
          ]
        },
        {
          "name": "vault",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "promo",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  109,
                  111
                ]
              }
            ]
          }
        },
        {
          "name": "promoToken",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  109,
                  111,
                  95,
                  116,
                  111,
                  107,
                  101,
                  110
                ]
              }
            ]
          }
        },
        {
          "name": "mint",
          "relations": [
            "vault"
          ]
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "config",
          "type": {
            "defined": {
              "name": "promoConfig"
            }
          }
        }
      ]
    },
    {
      "name": "initialize",
      "docs": [
        "Only the program's upgrade authority can initialize; it becomes the admin."
      ],
      "discriminator": [
        175,
        175,
        109,
        31,
        13,
        152,
        155,
        237
      ],
      "accounts": [
        {
          "name": "admin",
          "docs": [
            "Must be the program's upgrade authority, so nobody can front-run the setup."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "program",
          "address": "2css9q2M2SH4ekVjLYs9dfnEQpsxMprrYUrM2hWzVokd"
        },
        {
          "name": "programData"
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "vaultToken",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  116,
                  111,
                  107,
                  101,
                  110
                ]
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "treasury"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "relayer",
          "type": "pubkey"
        },
        {
          "name": "config",
          "type": {
            "defined": {
              "name": "config"
            }
          }
        }
      ]
    },
    {
      "name": "openAccount",
      "discriminator": [
        101,
        152,
        91,
        243,
        176,
        36,
        189,
        101
      ],
      "accounts": [
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "payer",
          "docs": [
            "The relay: pays rents and fees in SOL, repaid in USDC from the deposit."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "player",
          "signer": true
        },
        {
          "name": "vaultToken",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  116,
                  111,
                  107,
                  101,
                  110
                ]
              }
            ]
          }
        },
        {
          "name": "treasury",
          "writable": true,
          "relations": [
            "vault"
          ]
        },
        {
          "name": "playerToken",
          "writable": true
        },
        {
          "name": "mint",
          "relations": [
            "vault"
          ]
        },
        {
          "name": "account",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "player"
              }
            ]
          }
        },
        {
          "name": "ledger",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  101,
                  100,
                  103,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "player"
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "maxWin",
          "type": "u64"
        }
      ]
    },
    {
      "name": "openTable",
      "discriminator": [
        251,
        98,
        127,
        54,
        103,
        12,
        106,
        246
      ],
      "accounts": [
        {
          "name": "vault",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "payer",
          "docs": [
            "The relay: pays the rent."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "player"
        },
        {
          "name": "ledger",
          "docs": [
            "Only players with an account get a table."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  101,
                  100,
                  103,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "player"
              }
            ]
          }
        },
        {
          "name": "table",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  106,
                  116,
                  97,
                  98,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "player"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "payPromo",
      "discriminator": [
        251,
        77,
        135,
        219,
        193,
        211,
        29,
        161
      ],
      "accounts": [
        {
          "name": "relayer",
          "docs": [
            "The relay: decides who won (off-chain competitions and drops), pays the payout record's rent."
          ],
          "writable": true,
          "signer": true,
          "relations": [
            "vault"
          ]
        },
        {
          "name": "vault",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "promo",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  109,
                  111
                ]
              }
            ]
          }
        },
        {
          "name": "promoToken",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  109,
                  111,
                  95,
                  116,
                  111,
                  107,
                  101,
                  110
                ]
              }
            ]
          }
        },
        {
          "name": "payout",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  97,
                  121,
                  111,
                  117,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "payoutId"
              }
            ]
          }
        },
        {
          "name": "playerToken",
          "writable": true
        },
        {
          "name": "mint",
          "relations": [
            "vault"
          ]
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "payoutId",
          "type": {
            "array": [
              "u8",
              16
            ]
          }
        },
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "payWithdrawals",
      "discriminator": [
        225,
        142,
        98,
        75,
        170,
        146,
        8,
        248
      ],
      "accounts": [
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "account",
          "docs": [
            "claim is checked against the ledger by `checked_due`."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "ledger.player",
                "account": "ledger"
              }
            ]
          }
        },
        {
          "name": "vaultToken",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  116,
                  111,
                  107,
                  101,
                  110
                ]
              }
            ]
          }
        },
        {
          "name": "playerToken",
          "writable": true
        },
        {
          "name": "mint",
          "relations": [
            "vault"
          ]
        },
        {
          "name": "ledger",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  101,
                  100,
                  103,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "ledger.player",
                "account": "ledger"
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "thisProgram",
          "address": "2css9q2M2SH4ekVjLYs9dfnEQpsxMprrYUrM2hWzVokd"
        },
        {
          "name": "escrowAuth"
        },
        {
          "name": "escrow",
          "docs": [
            "restricts this instruction to the post-commit action path."
          ],
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "processUndelegation",
      "discriminator": [
        196,
        28,
        41,
        206,
        48,
        37,
        51,
        167
      ],
      "accounts": [
        {
          "name": "baseAccount",
          "writable": true
        },
        {
          "name": "buffer",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  110,
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  101,
                  45,
                  98,
                  117,
                  102,
                  102,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "baseAccount"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                181,
                183,
                0,
                225,
                242,
                87,
                58,
                192,
                204,
                6,
                34,
                1,
                52,
                74,
                207,
                151,
                184,
                53,
                6,
                235,
                140,
                229,
                25,
                152,
                204,
                98,
                126,
                24,
                147,
                128,
                167,
                62
              ]
            }
          }
        },
        {
          "name": "payer",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "accountSeeds",
          "type": {
            "vec": "bytes"
          }
        }
      ]
    },
    {
      "name": "raiseWinCap",
      "discriminator": [
        65,
        167,
        19,
        207,
        172,
        97,
        6,
        209
      ],
      "accounts": [
        {
          "name": "relayer",
          "signer": true
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "vaultToken",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  116,
                  111,
                  107,
                  101,
                  110
                ]
              }
            ]
          }
        },
        {
          "name": "ledger",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  101,
                  100,
                  103,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "ledger.player",
                "account": "ledger"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "releaseWithdrawals",
      "discriminator": [
        187,
        212,
        105,
        226,
        114,
        183,
        168,
        2
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "vault"
          ]
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "account",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "ledger.player",
                "account": "ledger"
              }
            ]
          }
        },
        {
          "name": "vaultToken",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  116,
                  111,
                  107,
                  101,
                  110
                ]
              }
            ]
          }
        },
        {
          "name": "playerToken",
          "writable": true
        },
        {
          "name": "mint",
          "relations": [
            "vault"
          ]
        },
        {
          "name": "ledger",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  101,
                  100,
                  103,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "ledger.player",
                "account": "ledger"
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "rouletteSpin",
      "discriminator": [
        146,
        107,
        93,
        164,
        68,
        215,
        67,
        35
      ],
      "accounts": [
        {
          "name": "vault",
          "docs": [
            "Read-only copy of the Solana vault: relayer key and limits."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "payer",
          "docs": [
            "The Tilt relay, acting on the player's intents."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "account",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "account.player",
                "account": "playerAccount"
              }
            ]
          }
        },
        {
          "name": "ledger",
          "docs": [
            "Read-only copy of the Solana ledger, to credit new deposits."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  101,
                  100,
                  103,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "account.player",
                "account": "playerAccount"
              }
            ]
          }
        },
        {
          "name": "table",
          "docs": [
            "The player's blackjack table: required by blackjack rounds, omitted (program id)",
            "by the other games."
          ],
          "writable": true,
          "optional": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  106,
                  116,
                  97,
                  98,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "account.player",
                "account": "playerAccount"
              }
            ]
          }
        },
        {
          "name": "oracleQueue",
          "writable": true
        },
        {
          "name": "programIdentity",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  100,
                  101,
                  110,
                  116,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "vrfProgram",
          "address": "Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz"
        },
        {
          "name": "slotHashes",
          "address": "SysvarS1otHashes111111111111111111111111111"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "bet",
          "type": {
            "defined": {
              "name": "rouletteBet"
            }
          }
        },
        {
          "name": "clientSeed",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "setConfig",
      "discriminator": [
        108,
        158,
        154,
        175,
        212,
        98,
        52,
        66
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "vault"
          ]
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "config",
          "type": {
            "defined": {
              "name": "config"
            }
          }
        }
      ]
    },
    {
      "name": "setPromo",
      "discriminator": [
        108,
        142,
        218,
        41,
        147,
        82,
        221,
        74
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "vault"
          ]
        },
        {
          "name": "vault",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "promo",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  109,
                  111
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "config",
          "type": {
            "defined": {
              "name": "promoConfig"
            }
          }
        }
      ]
    },
    {
      "name": "setRoles",
      "discriminator": [
        119,
        86,
        129,
        161,
        55,
        23,
        250,
        12
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "vault"
          ]
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "admin",
          "type": "pubkey"
        },
        {
          "name": "relayer",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "slotsSpin",
      "discriminator": [
        114,
        241,
        129,
        225,
        104,
        144,
        12,
        82
      ],
      "accounts": [
        {
          "name": "vault",
          "docs": [
            "Read-only copy of the Solana vault: relayer key and limits."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "payer",
          "docs": [
            "The Tilt relay, acting on the player's intents."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "account",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "account.player",
                "account": "playerAccount"
              }
            ]
          }
        },
        {
          "name": "ledger",
          "docs": [
            "Read-only copy of the Solana ledger, to credit new deposits."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  101,
                  100,
                  103,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "account.player",
                "account": "playerAccount"
              }
            ]
          }
        },
        {
          "name": "table",
          "docs": [
            "The player's blackjack table: required by blackjack rounds, omitted (program id)",
            "by the other games."
          ],
          "writable": true,
          "optional": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  106,
                  116,
                  97,
                  98,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "account.player",
                "account": "playerAccount"
              }
            ]
          }
        },
        {
          "name": "oracleQueue",
          "writable": true
        },
        {
          "name": "programIdentity",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  100,
                  101,
                  110,
                  116,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "vrfProgram",
          "address": "Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz"
        },
        {
          "name": "slotHashes",
          "address": "SysvarS1otHashes111111111111111111111111111"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "clientSeed",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "withdraw",
      "discriminator": [
        183,
        18,
        70,
        156,
        148,
        109,
        161,
        34
      ],
      "accounts": [
        {
          "name": "vault",
          "docs": [
            "Read-only copy of the Solana vault: relayer key and limits."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "account",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "account.player",
                "account": "playerAccount"
              }
            ]
          }
        },
        {
          "name": "ledger",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  101,
                  100,
                  103,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "account.player",
                "account": "playerAccount"
              }
            ]
          }
        },
        {
          "name": "vaultToken"
        },
        {
          "name": "playerToken"
        },
        {
          "name": "mint"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "magicProgram",
          "address": "Magic11111111111111111111111111111111111111"
        },
        {
          "name": "magicContext",
          "writable": true,
          "address": "MagicContext1111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "withdrawHouse",
      "discriminator": [
        226,
        236,
        222,
        156,
        198,
        230,
        70,
        147
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "vault"
          ]
        },
        {
          "name": "vault",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "vaultToken",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  116,
                  111,
                  107,
                  101,
                  110
                ]
              }
            ]
          }
        },
        {
          "name": "treasury",
          "writable": true,
          "relations": [
            "vault"
          ]
        },
        {
          "name": "mint",
          "relations": [
            "vault"
          ]
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "withdrawPromo",
      "discriminator": [
        18,
        19,
        78,
        116,
        92,
        245,
        103,
        185
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "vault"
          ]
        },
        {
          "name": "vault",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "promo",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  109,
                  111
                ]
              }
            ]
          }
        },
        {
          "name": "promoToken",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  109,
                  111,
                  95,
                  116,
                  111,
                  107,
                  101,
                  110
                ]
              }
            ]
          }
        },
        {
          "name": "treasury",
          "writable": true,
          "relations": [
            "vault"
          ]
        },
        {
          "name": "mint",
          "relations": [
            "vault"
          ]
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "blackjackTable",
      "discriminator": [
        72,
        205,
        97,
        32,
        22,
        36,
        255,
        74
      ]
    },
    {
      "name": "ledger",
      "discriminator": [
        43,
        41,
        21,
        213,
        180,
        176,
        95,
        32
      ]
    },
    {
      "name": "playerAccount",
      "discriminator": [
        224,
        184,
        224,
        50,
        98,
        72,
        48,
        236
      ]
    },
    {
      "name": "promoPayout",
      "discriminator": [
        226,
        143,
        243,
        234,
        124,
        34,
        44,
        235
      ]
    },
    {
      "name": "promoPool",
      "discriminator": [
        228,
        169,
        114,
        18,
        108,
        140,
        32,
        93
      ]
    },
    {
      "name": "vault",
      "discriminator": [
        211,
        8,
        232,
        43,
        2,
        152,
        117,
        119
      ]
    }
  ],
  "events": [
    {
      "name": "lossReleased",
      "discriminator": [
        112,
        239,
        90,
        44,
        29,
        179,
        34,
        124
      ]
    },
    {
      "name": "promoPaid",
      "discriminator": [
        112,
        218,
        201,
        42,
        25,
        63,
        239,
        10
      ]
    },
    {
      "name": "roundSettled",
      "discriminator": [
        249,
        225,
        66,
        54,
        157,
        200,
        234,
        222
      ]
    },
    {
      "name": "withdrawalHeld",
      "discriminator": [
        180,
        74,
        158,
        172,
        229,
        207,
        59,
        174
      ]
    },
    {
      "name": "withdrawalPaid",
      "discriminator": [
        8,
        50,
        221,
        38,
        250,
        161,
        167,
        124
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "amountOutOfRange",
      "msg": "Amount out of range"
    },
    {
      "code": 6001,
      "name": "depositTooSmall",
      "msg": "First deposit must exceed the onboarding fee"
    },
    {
      "code": 6002,
      "name": "noDeposit",
      "msg": "Account has no deposit"
    },
    {
      "code": 6003,
      "name": "vaultTooSmall",
      "msg": "Vault cannot cover this"
    },
    {
      "code": 6004,
      "name": "roundInProgress",
      "msg": "A round is already in progress"
    },
    {
      "code": 6005,
      "name": "wrongState",
      "msg": "Instruction not valid in the current round state"
    },
    {
      "code": 6006,
      "name": "unauthorized",
      "msg": "unauthorized"
    },
    {
      "code": 6007,
      "name": "insufficientBalance",
      "msg": "Insufficient balance"
    },
    {
      "code": 6008,
      "name": "winCapReached",
      "msg": "Lifetime win cap reached"
    },
    {
      "code": 6009,
      "name": "roundGainTooHigh",
      "msg": "This bet could win more than one round allows"
    },
    {
      "code": 6010,
      "name": "invalidBet",
      "msg": "Invalid bet"
    },
    {
      "code": 6011,
      "name": "roundNotExpired",
      "msg": "Round has not expired yet"
    },
    {
      "code": 6012,
      "name": "fraudSuspected",
      "msg": "Rollup claim inconsistent with Solana's ledger"
    },
    {
      "code": 6013,
      "name": "paused",
      "msg": "paused"
    },
    {
      "code": 6014,
      "name": "maxWinTooHigh",
      "msg": "Max win above the allowed limit"
    },
    {
      "code": 6015,
      "name": "withdrawalTooSmall",
      "msg": "Withdrawal below the minimum"
    },
    {
      "code": 6016,
      "name": "nothingToCheckpoint",
      "msg": "No loss to release"
    },
    {
      "code": 6017,
      "name": "staleRandomness",
      "msg": "Randomness does not answer the pending request"
    },
    {
      "code": 6018,
      "name": "invalidConfig",
      "msg": "Invalid configuration"
    },
    {
      "code": 6019,
      "name": "promoCapReached",
      "msg": "Promo payout above the pool's limits"
    },
    {
      "code": 6020,
      "name": "missingTable",
      "msg": "Blackjack needs the player's table account"
    }
  ],
  "types": [
    {
      "name": "baccaratBet",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "player"
          },
          {
            "name": "banker"
          },
          {
            "name": "tie"
          }
        ]
      }
    },
    {
      "name": "baccaratCoup",
      "docs": [
        "Cards are ranks 1 (ace) to 13; empty slots are 0."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bet",
            "type": {
              "defined": {
                "name": "baccaratBet"
              }
            }
          },
          {
            "name": "player",
            "type": {
              "array": [
                "u8",
                3
              ]
            }
          },
          {
            "name": "banker",
            "type": {
              "array": [
                "u8",
                3
              ]
            }
          }
        ]
      }
    },
    {
      "name": "blackjackHand",
      "docs": [
        "Legacy single-hand blackjack state, never written since blackjack moved to",
        "`BlackjackTable`. Kept only so `PlayerAccount` keeps its byte layout (accounts already",
        "delegated, withdrawals deserialize it)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "player",
            "type": {
              "array": [
                "u8",
                21
              ]
            }
          },
          {
            "name": "nPlayer",
            "type": "u8"
          },
          {
            "name": "dealer",
            "type": {
              "array": [
                "u8",
                21
              ]
            }
          },
          {
            "name": "nDealer",
            "type": "u8"
          },
          {
            "name": "doubled",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "blackjackTable",
      "docs": [
        "The player's blackjack round: hands and dealer. Lives in the rollup next to the player",
        "account; between rounds it keeps the last round for display."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "player",
            "type": "pubkey"
          },
          {
            "name": "bet",
            "docs": [
              "Base bet of every hand (a doubled hand stakes twice this)."
            ],
            "type": "u64"
          },
          {
            "name": "hands",
            "docs": [
              "Every hand in playing order: a hand born from a split comes right after the one",
              "it was split from."
            ],
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "tableHand"
                  }
                },
                10
              ]
            }
          },
          {
            "name": "nHands",
            "type": "u8"
          },
          {
            "name": "active",
            "docs": [
              "Index of the hand to play while the round waits for the player; `n_hands` once",
              "every hand is finished."
            ],
            "type": "u8"
          },
          {
            "name": "dealer",
            "type": {
              "array": [
                "u8",
                21
              ]
            }
          },
          {
            "name": "nDealer",
            "type": "u8"
          },
          {
            "name": "splits",
            "docs": [
              "Splits played this round, all hands together (at most `MAX_SPLITS`)."
            ],
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "config",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "minBet",
            "docs": [
              "Smallest stake; below it the 1% fee would round to nothing while Tilt still pays the round."
            ],
            "type": "u64"
          },
          {
            "name": "maxBet",
            "docs": [
              "Largest stake for one round, in USDC base units."
            ],
            "type": "u64"
          },
          {
            "name": "maxRoundGain",
            "docs": [
              "Largest gain one round may produce (caps e.g. straight-up roulette and slot jackpots)."
            ],
            "type": "u64"
          },
          {
            "name": "maxPlayerWin",
            "docs": [
              "Largest lifetime net win reserved for one player."
            ],
            "type": "u64"
          },
          {
            "name": "maxWinMultiple",
            "docs": [
              "A player's reserved max win may not exceed this multiple of their first deposit."
            ],
            "type": "u64"
          },
          {
            "name": "onboardingFee",
            "docs": [
              "What Tilt advances in SOL to open an account, kept in USDC from the first deposit."
            ],
            "type": "u64"
          },
          {
            "name": "minDeposit",
            "docs": [
              "Smallest deposit after the first one. At least `min_withdrawal`, so a dust deposit",
              "cannot be withdrawn right back through the \"empty the balance\" exception, each round",
              "trip making Tilt pay a commit."
            ],
            "type": "u64"
          },
          {
            "name": "minWithdrawal",
            "docs": [
              "Smaller withdrawals are refused unless they empty the balance (each one costs a commit)."
            ],
            "type": "u64"
          },
          {
            "name": "maxWithdrawal",
            "docs": [
              "Withdrawals above this are held for review."
            ],
            "type": "u64"
          },
          {
            "name": "playerDailyCap",
            "docs": [
              "Paid automatically to one player per 24 h block; beyond it, their withdrawals are held.",
              "Blocks are fixed, not rolling: up to twice this can go out around a block boundary."
            ],
            "type": "u64"
          },
          {
            "name": "dailyCap",
            "docs": [
              "House money (paid beyond players' own deposits) sent automatically per 24 h block."
            ],
            "type": "u64"
          },
          {
            "name": "roundTimeoutSecs",
            "docs": [
              "A round untouched this long can be closed by the relayer."
            ],
            "type": "i64"
          },
          {
            "name": "validator",
            "docs": [
              "The only rollup validator player accounts may be delegated to."
            ],
            "type": "pubkey"
          },
          {
            "name": "vrfQueue",
            "docs": [
              "The only MagicBlock VRF queue draws may come from."
            ],
            "type": "pubkey"
          },
          {
            "name": "depositsPaused",
            "type": "bool"
          },
          {
            "name": "betsPaused",
            "type": "bool"
          },
          {
            "name": "payoutsPaused",
            "docs": [
              "Holds every automatic payment (Tilt can still release after review)."
            ],
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "draw",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "deal"
          },
          {
            "name": "hit"
          },
          {
            "name": "double"
          },
          {
            "name": "dealer"
          },
          {
            "name": "spin"
          },
          {
            "name": "split"
          }
        ]
      }
    },
    {
      "name": "game",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "blackjack"
          },
          {
            "name": "roulette"
          },
          {
            "name": "baccarat"
          },
          {
            "name": "slots"
          }
        ]
      }
    },
    {
      "name": "ledger",
      "docs": [
        "Solana's own record of a player, never written by the rollup. Claims coming back",
        "from the rollup are checked against it."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "player",
            "type": "pubkey"
          },
          {
            "name": "deposited",
            "docs": [
              "USDC credited to the player on Solana (onboarding fee already deducted)."
            ],
            "type": "u64"
          },
          {
            "name": "withdrawnPaid",
            "type": "u64"
          },
          {
            "name": "forfeited",
            "docs": [
              "Player losses released from the reservation (see `checkpoint`)."
            ],
            "type": "u64"
          },
          {
            "name": "maxWin",
            "docs": [
              "The player's win cap: set at the first deposit, raised by `raise_win_cap` as they win."
            ],
            "type": "u64"
          },
          {
            "name": "windowStart",
            "type": "i64"
          },
          {
            "name": "windowPaid",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "lossReleased",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "player",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "forfeitedTotal",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "playerAccount",
      "docs": [
        "The player's balance and current round. Lives in the rollup permanently."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "player",
            "type": "pubkey"
          },
          {
            "name": "maxWin",
            "type": "u64"
          },
          {
            "name": "credited",
            "docs": [
              "Deposits already credited from the ledger; never decreases."
            ],
            "type": "u64"
          },
          {
            "name": "forfeited",
            "docs": [
              "Losses released from the vault reservation by `checkpoint`; never decreases."
            ],
            "type": "u64"
          },
          {
            "name": "withdrawn",
            "docs": [
              "Total ever withdrawn; never decreases."
            ],
            "type": "u64"
          },
          {
            "name": "balance",
            "type": "u64"
          },
          {
            "name": "rounds",
            "type": "u32"
          },
          {
            "name": "fees",
            "docs": [
              "Tilt's 1% fees taken from this player's winning rounds."
            ],
            "type": "u64"
          },
          {
            "name": "round",
            "type": {
              "defined": {
                "name": "round"
              }
            }
          }
        ]
      }
    },
    {
      "name": "promoConfig",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "maxPayout",
            "docs": [
              "Largest single payout."
            ],
            "type": "u64"
          },
          {
            "name": "dailyCap",
            "docs": [
              "Paid out per 24 h block (fixed blocks, like withdrawals)."
            ],
            "type": "u64"
          },
          {
            "name": "paused",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "promoPaid",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "payoutId",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "player",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "promoPayout",
      "docs": [
        "One per payout id: a payout can never be made twice, whatever the relay does."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "player",
            "docs": [
              "Owner of the token account that was paid."
            ],
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "paidAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "promoPool",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "tokenBump",
            "type": "u8"
          },
          {
            "name": "config",
            "type": {
              "defined": {
                "name": "promoConfig"
              }
            }
          },
          {
            "name": "windowStart",
            "type": "i64"
          },
          {
            "name": "windowPaid",
            "type": "u64"
          },
          {
            "name": "paidTotal",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "rouletteBet",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "straight",
            "fields": [
              "u8"
            ]
          },
          {
            "name": "red"
          },
          {
            "name": "black"
          },
          {
            "name": "odd"
          },
          {
            "name": "even"
          },
          {
            "name": "low"
          },
          {
            "name": "high"
          },
          {
            "name": "dozen",
            "fields": [
              "u8"
            ]
          },
          {
            "name": "column",
            "fields": [
              "u8"
            ]
          }
        ]
      }
    },
    {
      "name": "rouletteSpin",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bet",
            "type": {
              "defined": {
                "name": "rouletteBet"
              }
            }
          },
          {
            "name": "number",
            "docs": [
              "0 to 36 once spun."
            ],
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "round",
      "docs": [
        "The current or last round. Lives in the player account, so an unfinished round",
        "survives disconnections and can be resumed."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "game",
            "type": {
              "defined": {
                "name": "game"
              }
            }
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "roundStatus"
              }
            }
          },
          {
            "name": "stake",
            "docs": [
              "Total stake, every blackjack hand, double and split included."
            ],
            "type": "u64"
          },
          {
            "name": "lastAction",
            "type": "i64"
          },
          {
            "name": "requestId",
            "docs": [
              "Id of the VRF request the round is waiting for; any other callback is refused."
            ],
            "type": "u64"
          },
          {
            "name": "payout",
            "type": "u64"
          },
          {
            "name": "fee",
            "type": "u64"
          },
          {
            "name": "blackjack",
            "docs": [
              "Legacy, always default: blackjack rounds live in `BlackjackTable`."
            ],
            "type": {
              "defined": {
                "name": "blackjackHand"
              }
            }
          },
          {
            "name": "roulette",
            "type": {
              "option": {
                "defined": {
                  "name": "rouletteSpin"
                }
              }
            }
          },
          {
            "name": "baccarat",
            "type": {
              "option": {
                "defined": {
                  "name": "baccaratCoup"
                }
              }
            }
          },
          {
            "name": "slots",
            "type": {
              "defined": {
                "name": "slotsSpin"
              }
            }
          }
        ]
      }
    },
    {
      "name": "roundSettled",
      "docs": [
        "Emitted in the rollup when a round ends; with the account state, enough to display",
        "and verify the round (replay `randomness` through the game rules)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "player",
            "type": "pubkey"
          },
          {
            "name": "round",
            "type": "u32"
          },
          {
            "name": "game",
            "type": {
              "defined": {
                "name": "game"
              }
            }
          },
          {
            "name": "stake",
            "type": "u64"
          },
          {
            "name": "payout",
            "type": "u64"
          },
          {
            "name": "fee",
            "type": "u64"
          },
          {
            "name": "requestId",
            "type": "u64"
          },
          {
            "name": "randomness",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "roundStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "idle"
          },
          {
            "name": "awaitingDraw",
            "fields": [
              {
                "defined": {
                  "name": "draw"
                }
              }
            ]
          },
          {
            "name": "playerTurn"
          }
        ]
      }
    },
    {
      "name": "slotsSpin",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "reels",
            "type": {
              "array": [
                "u8",
                3
              ]
            }
          }
        ]
      }
    },
    {
      "name": "tableHand",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "cards",
            "type": {
              "array": [
                "u8",
                21
              ]
            }
          },
          {
            "name": "nCards",
            "type": "u8"
          },
          {
            "name": "doubled",
            "type": "bool"
          },
          {
            "name": "split",
            "docs": [
              "Born from a split (both hands of the split): its 21 is not a blackjack, and split",
              "aces (first card an ace) take no card after the split one."
            ],
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "vault",
      "docs": [
        "House state, on Solana. Owns the USDC token account that pays every player."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "docs": [
              "Configuration, roles and house funds (meant to be a multisig)."
            ],
            "type": "pubkey"
          },
          {
            "name": "relayer",
            "docs": [
              "Hot key of the relay: plays for players and pays fees. Rotatable by the admin."
            ],
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "treasury",
            "docs": [
              "Receives onboarding fees and house withdrawals."
            ],
            "type": "pubkey"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "tokenBump",
            "type": "u8"
          },
          {
            "name": "reserved",
            "docs": [
              "What the vault may owe in the worst case: for every player,",
              "deposited - forfeited - withdrawn_paid + max_win."
            ],
            "type": "u64"
          },
          {
            "name": "config",
            "type": {
              "defined": {
                "name": "config"
              }
            }
          },
          {
            "name": "windowStart",
            "type": "i64"
          },
          {
            "name": "windowPaid",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "withdrawalHeld",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "player",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "withdrawalPaid",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "player",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "withdrawnTotal",
            "type": "u64"
          }
        ]
      }
    }
  ]
};
