/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/tilt.json`.
 */
export type Tilt = {
  "address": "7TurAMr1B6VWq5U3KSkXgNc7debxV6rWUAGsNARbHEB8",
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
          "address": "7TurAMr1B6VWq5U3KSkXgNc7debxV6rWUAGsNARbHEB8"
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
          "name": "riskPool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  105,
                  115,
                  107,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
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
          "name": "riskPool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  105,
                  115,
                  107,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
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
          "name": "riskPool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  105,
                  115,
                  107,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
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
          "name": "riskPool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  105,
                  115,
                  107,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
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
          "name": "riskPool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  105,
                  115,
                  107,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
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
          "name": "riskPool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  105,
                  115,
                  107,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
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
      "name": "consumeHiloRandomness",
      "discriminator": [
        37,
        137,
        187,
        222,
        247,
        7,
        145,
        67
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
            "Must be a player account PDA, like in `consume_randomness`."
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
          "name": "board",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  105,
                  108,
                  111
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
          "name": "riskPool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  105,
                  115,
                  107,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
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
      "name": "consumeMinesRandomness",
      "discriminator": [
        174,
        238,
        197,
        25,
        162,
        187,
        47,
        82
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
            "Must be a player account PDA, like in `consume_randomness`."
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
          "name": "board",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  105,
                  110,
                  101,
                  115
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
          "name": "riskPool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  105,
                  115,
                  107,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
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
      "name": "consumeQuickRandomness",
      "discriminator": [
        23,
        133,
        148,
        195,
        1,
        101,
        50,
        186
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
            "Must be a player account PDA, like in `consume_randomness`."
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
          "name": "quick",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  113,
                  117,
                  105,
                  99,
                  107
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
          "name": "riskPool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  105,
                  115,
                  107,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
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
        },
        {
          "name": "riskPool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  105,
                  115,
                  107,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
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
      "name": "consumeRouletteRandomness",
      "discriminator": [
        117,
        66,
        145,
        192,
        102,
        107,
        238,
        43
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
            "Must be a player account PDA, like in `consume_randomness`."
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
          "name": "roulette",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  117,
                  108,
                  101,
                  116,
                  116,
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
          "name": "riskPool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  105,
                  115,
                  107,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
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
      "name": "consumeTowerRandomness",
      "discriminator": [
        44,
        114,
        165,
        76,
        206,
        99,
        162,
        214
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
            "Must be a player account PDA, like in `consume_randomness`."
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
          "name": "board",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  111,
                  119,
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
          "name": "riskPool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  105,
                  115,
                  107,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
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
                96,
                10,
                250,
                66,
                124,
                27,
                10,
                166,
                248,
                127,
                94,
                74,
                147,
                64,
                223,
                145,
                92,
                38,
                248,
                135,
                182,
                46,
                43,
                235,
                104,
                144,
                196,
                179,
                231,
                250,
                235,
                127
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
          "address": "7TurAMr1B6VWq5U3KSkXgNc7debxV6rWUAGsNARbHEB8"
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
      "name": "delegateHiloBoard",
      "discriminator": [
        51,
        208,
        96,
        164,
        114,
        83,
        129,
        94
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
          "name": "bufferBoard",
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
                "path": "board"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                96,
                10,
                250,
                66,
                124,
                27,
                10,
                166,
                248,
                127,
                94,
                74,
                147,
                64,
                223,
                145,
                92,
                38,
                248,
                135,
                182,
                46,
                43,
                235,
                104,
                144,
                196,
                179,
                231,
                250,
                235,
                127
              ]
            }
          }
        },
        {
          "name": "delegationRecordBoard",
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
                "path": "board"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "delegationMetadataBoard",
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
                "path": "board"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "board",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  105,
                  108,
                  111
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
          "address": "7TurAMr1B6VWq5U3KSkXgNc7debxV6rWUAGsNARbHEB8"
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
      "name": "delegateMinesBoard",
      "discriminator": [
        129,
        56,
        185,
        149,
        207,
        164,
        206,
        200
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
          "name": "bufferBoard",
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
                "path": "board"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                96,
                10,
                250,
                66,
                124,
                27,
                10,
                166,
                248,
                127,
                94,
                74,
                147,
                64,
                223,
                145,
                92,
                38,
                248,
                135,
                182,
                46,
                43,
                235,
                104,
                144,
                196,
                179,
                231,
                250,
                235,
                127
              ]
            }
          }
        },
        {
          "name": "delegationRecordBoard",
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
                "path": "board"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "delegationMetadataBoard",
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
                "path": "board"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "board",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  105,
                  110,
                  101,
                  115
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
          "address": "7TurAMr1B6VWq5U3KSkXgNc7debxV6rWUAGsNARbHEB8"
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
      "name": "delegateQuickTable",
      "discriminator": [
        155,
        142,
        124,
        85,
        189,
        1,
        22,
        14
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
          "name": "bufferQuick",
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
                "path": "quick"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                96,
                10,
                250,
                66,
                124,
                27,
                10,
                166,
                248,
                127,
                94,
                74,
                147,
                64,
                223,
                145,
                92,
                38,
                248,
                135,
                182,
                46,
                43,
                235,
                104,
                144,
                196,
                179,
                231,
                250,
                235,
                127
              ]
            }
          }
        },
        {
          "name": "delegationRecordQuick",
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
                "path": "quick"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "delegationMetadataQuick",
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
                "path": "quick"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "quick",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  113,
                  117,
                  105,
                  99,
                  107
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
          "address": "7TurAMr1B6VWq5U3KSkXgNc7debxV6rWUAGsNARbHEB8"
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
      "name": "delegateRiskPool",
      "discriminator": [
        139,
        10,
        122,
        135,
        85,
        99,
        226,
        193
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
          "name": "bufferRiskPool",
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
                "path": "riskPool"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                96,
                10,
                250,
                66,
                124,
                27,
                10,
                166,
                248,
                127,
                94,
                74,
                147,
                64,
                223,
                145,
                92,
                38,
                248,
                135,
                182,
                46,
                43,
                235,
                104,
                144,
                196,
                179,
                231,
                250,
                235,
                127
              ]
            }
          }
        },
        {
          "name": "delegationRecordRiskPool",
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
                "path": "riskPool"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "delegationMetadataRiskPool",
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
                "path": "riskPool"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "riskPool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  105,
                  115,
                  107,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "ownerProgram",
          "address": "7TurAMr1B6VWq5U3KSkXgNc7debxV6rWUAGsNARbHEB8"
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
      "name": "delegateRouletteTable",
      "discriminator": [
        254,
        4,
        230,
        223,
        145,
        226,
        99,
        243
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
          "name": "bufferRoulette",
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
                "path": "roulette"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                96,
                10,
                250,
                66,
                124,
                27,
                10,
                166,
                248,
                127,
                94,
                74,
                147,
                64,
                223,
                145,
                92,
                38,
                248,
                135,
                182,
                46,
                43,
                235,
                104,
                144,
                196,
                179,
                231,
                250,
                235,
                127
              ]
            }
          }
        },
        {
          "name": "delegationRecordRoulette",
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
                "path": "roulette"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "delegationMetadataRoulette",
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
                "path": "roulette"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "roulette",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  117,
                  108,
                  101,
                  116,
                  116,
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
          "address": "7TurAMr1B6VWq5U3KSkXgNc7debxV6rWUAGsNARbHEB8"
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
                96,
                10,
                250,
                66,
                124,
                27,
                10,
                166,
                248,
                127,
                94,
                74,
                147,
                64,
                223,
                145,
                92,
                38,
                248,
                135,
                182,
                46,
                43,
                235,
                104,
                144,
                196,
                179,
                231,
                250,
                235,
                127
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
          "address": "7TurAMr1B6VWq5U3KSkXgNc7debxV6rWUAGsNARbHEB8"
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
      "name": "delegateTowerBoard",
      "discriminator": [
        20,
        220,
        121,
        220,
        11,
        238,
        211,
        102
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
          "name": "bufferBoard",
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
                "path": "board"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                96,
                10,
                250,
                66,
                124,
                27,
                10,
                166,
                248,
                127,
                94,
                74,
                147,
                64,
                223,
                145,
                92,
                38,
                248,
                135,
                182,
                46,
                43,
                235,
                104,
                144,
                196,
                179,
                231,
                250,
                235,
                127
              ]
            }
          }
        },
        {
          "name": "delegationRecordBoard",
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
                "path": "board"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "delegationMetadataBoard",
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
                "path": "board"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "board",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  111,
                  119,
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
          "name": "ownerProgram",
          "address": "7TurAMr1B6VWq5U3KSkXgNc7debxV6rWUAGsNARbHEB8"
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
      "name": "diceRoll",
      "discriminator": [
        234,
        73,
        108,
        215,
        140,
        60,
        156,
        90
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
          "name": "quick",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  113,
                  117,
                  105,
                  99,
                  107
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
          "name": "riskPool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  105,
                  115,
                  107,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
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
          "name": "target",
          "type": "u16"
        },
        {
          "name": "over",
          "type": "bool"
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
      "name": "expireHiloRound",
      "discriminator": [
        15,
        225,
        190,
        88,
        2,
        101,
        44,
        155
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
          "name": "board",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  105,
                  108,
                  111
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
          "name": "riskPool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  105,
                  115,
                  107,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
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
      "name": "expireMinesRound",
      "discriminator": [
        174,
        204,
        13,
        246,
        67,
        255,
        164,
        88
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
          "name": "board",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  105,
                  110,
                  101,
                  115
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
          "name": "riskPool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  105,
                  115,
                  107,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
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
      "name": "expireQuickRound",
      "discriminator": [
        137,
        150,
        110,
        6,
        153,
        80,
        237,
        4
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
          "name": "quick",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  113,
                  117,
                  105,
                  99,
                  107
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
          "name": "riskPool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  105,
                  115,
                  107,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
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
      "name": "expireRouletteRound",
      "discriminator": [
        237,
        22,
        3,
        152,
        43,
        146,
        109,
        237
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
          "name": "roulette",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  117,
                  108,
                  101,
                  116,
                  116,
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
          "name": "riskPool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  105,
                  115,
                  107,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
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
          "name": "riskPool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  105,
                  115,
                  107,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
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
      "name": "expireTowerRound",
      "discriminator": [
        28,
        106,
        79,
        164,
        112,
        188,
        98,
        174
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
          "name": "board",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  111,
                  119,
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
          "name": "riskPool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  105,
                  115,
                  107,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
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
      "name": "flipPlay",
      "discriminator": [
        235,
        86,
        68,
        222,
        71,
        50,
        124,
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
          "name": "quick",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  113,
                  117,
                  105,
                  99,
                  107
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
          "name": "riskPool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  105,
                  115,
                  107,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
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
          "name": "side",
          "type": {
            "defined": {
              "name": "coinSide"
            }
          }
        },
        {
          "name": "flips",
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
      "name": "fundRiskPool",
      "discriminator": [
        231,
        167,
        50,
        246,
        96,
        115,
        103,
        21
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
      "name": "hiloBet",
      "discriminator": [
        118,
        3,
        52,
        186,
        203,
        2,
        131,
        90
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
          "name": "board",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  105,
                  108,
                  111
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
          "name": "riskPool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  105,
                  115,
                  107,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
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
      "name": "hiloCashout",
      "discriminator": [
        204,
        176,
        5,
        148,
        52,
        151,
        121,
        197
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
          "name": "board",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  105,
                  108,
                  111
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
          "name": "riskPool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  105,
                  115,
                  107,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
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
      "args": []
    },
    {
      "name": "hiloGuess",
      "discriminator": [
        105,
        169,
        249,
        238,
        217,
        122,
        252,
        172
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
          "name": "board",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  105,
                  108,
                  111
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
          "name": "riskPool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  105,
                  115,
                  107,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
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
          "name": "guess",
          "type": {
            "defined": {
              "name": "hiloMove"
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
          "address": "7TurAMr1B6VWq5U3KSkXgNc7debxV6rWUAGsNARbHEB8"
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
      "name": "kenoPlay",
      "discriminator": [
        242,
        188,
        242,
        121,
        145,
        221,
        18,
        110
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
          "name": "quick",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  113,
                  117,
                  105,
                  99,
                  107
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
          "name": "riskPool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  105,
                  115,
                  107,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
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
          "name": "picks",
          "type": "bytes"
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
      "name": "limboPlay",
      "discriminator": [
        232,
        13,
        252,
        254,
        68,
        163,
        240,
        9
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
          "name": "quick",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  113,
                  117,
                  105,
                  99,
                  107
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
          "name": "riskPool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  105,
                  115,
                  107,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
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
          "name": "target",
          "type": "u32"
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
      "name": "minesBet",
      "discriminator": [
        25,
        147,
        75,
        108,
        163,
        85,
        219,
        79
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
          "name": "board",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  105,
                  110,
                  101,
                  115
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
          "name": "riskPool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  105,
                  115,
                  107,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
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
          "name": "mines",
          "type": "u8"
        }
      ]
    },
    {
      "name": "minesCashout",
      "discriminator": [
        179,
        158,
        112,
        181,
        138,
        69,
        229,
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
          "name": "board",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  105,
                  110,
                  101,
                  115
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
          "name": "riskPool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  105,
                  115,
                  107,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
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
      "args": []
    },
    {
      "name": "minesReveal",
      "discriminator": [
        64,
        219,
        35,
        218,
        106,
        67,
        52,
        132
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
          "name": "board",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  105,
                  110,
                  101,
                  115
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
          "name": "riskPool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  105,
                  115,
                  107,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
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
          "name": "tile",
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
        }
      ]
    },
    {
      "name": "openHiloBoard",
      "discriminator": [
        118,
        243,
        36,
        96,
        9,
        31,
        42,
        50
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
            "Only players with an account get a board."
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
          "name": "board",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  105,
                  108,
                  111
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
      "name": "openMinesBoard",
      "discriminator": [
        90,
        34,
        4,
        159,
        90,
        65,
        81,
        128
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
            "Only players with an account get a board."
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
          "name": "board",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  105,
                  110,
                  101,
                  115
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
      "name": "openQuickTable",
      "discriminator": [
        129,
        0,
        10,
        24,
        182,
        8,
        97,
        166
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
          "name": "quick",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  113,
                  117,
                  105,
                  99,
                  107
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
      "name": "openRiskPool",
      "discriminator": [
        63,
        125,
        127,
        255,
        173,
        96,
        42,
        40
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
          "name": "riskPool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  105,
                  115,
                  107,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
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
      "name": "openRouletteTable",
      "discriminator": [
        49,
        44,
        68,
        140,
        203,
        78,
        16,
        227
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
          "name": "roulette",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  117,
                  108,
                  101,
                  116,
                  116,
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
      "name": "openTowerBoard",
      "discriminator": [
        174,
        47,
        60,
        198,
        232,
        108,
        18,
        17
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
            "Only players with an account get a board."
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
          "name": "board",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  111,
                  119,
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
          "address": "7TurAMr1B6VWq5U3KSkXgNc7debxV6rWUAGsNARbHEB8"
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
      "name": "rouletteChips",
      "discriminator": [
        249,
        169,
        216,
        6,
        47,
        108,
        68,
        58
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
          "name": "roulette",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  117,
                  108,
                  101,
                  116,
                  116,
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
          "name": "riskPool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  105,
                  115,
                  107,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
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
          "name": "chips",
          "type": {
            "vec": {
              "defined": {
                "name": "rouletteChip"
              }
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
          "name": "riskPool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  105,
                  115,
                  107,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
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
          "name": "riskPool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  105,
                  115,
                  107,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
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
      "name": "towerBet",
      "discriminator": [
        181,
        251,
        4,
        223,
        81,
        204,
        188,
        39
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
          "name": "board",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  111,
                  119,
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
          "name": "riskPool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  105,
                  115,
                  107,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
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
          "name": "difficulty",
          "type": {
            "defined": {
              "name": "towerDifficulty"
            }
          }
        }
      ]
    },
    {
      "name": "towerCashout",
      "discriminator": [
        32,
        176,
        240,
        31,
        80,
        146,
        198,
        141
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
          "name": "board",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  111,
                  119,
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
          "name": "riskPool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  105,
                  115,
                  107,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
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
      "args": []
    },
    {
      "name": "towerClimb",
      "discriminator": [
        188,
        8,
        210,
        174,
        14,
        117,
        173,
        140
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
          "name": "board",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  111,
                  119,
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
          "name": "riskPool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  105,
                  115,
                  107,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
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
          "name": "tile",
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
      "name": "wheelSpin",
      "discriminator": [
        33,
        80,
        241,
        178,
        59,
        53,
        115,
        118
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
          "name": "quick",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  113,
                  117,
                  105,
                  99,
                  107
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
          "name": "riskPool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  105,
                  115,
                  107,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
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
          "name": "segments",
          "type": "u8"
        },
        {
          "name": "risk",
          "type": {
            "defined": {
              "name": "wheelRisk"
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
          "name": "riskPool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  105,
                  115,
                  107,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
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
      "name": "hiloBoard",
      "discriminator": [
        237,
        183,
        5,
        178,
        43,
        57,
        187,
        183
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
      "name": "minesBoard",
      "discriminator": [
        103,
        212,
        51,
        227,
        187,
        87,
        125,
        68
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
      "name": "quickTable",
      "discriminator": [
        177,
        219,
        22,
        66,
        61,
        202,
        93,
        72
      ]
    },
    {
      "name": "riskPool",
      "discriminator": [
        101,
        46,
        90,
        100,
        248,
        9,
        6,
        213
      ]
    },
    {
      "name": "rouletteTable",
      "discriminator": [
        176,
        198,
        27,
        37,
        5,
        37,
        240,
        139
      ]
    },
    {
      "name": "towerBoard",
      "discriminator": [
        168,
        237,
        122,
        115,
        60,
        25,
        237,
        159
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
      "name": "winsReleased",
      "discriminator": [
        200,
        218,
        6,
        169,
        223,
        22,
        124,
        244
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
      "name": "riskPoolFull",
      "msg": "The house's risk pool cannot cover this bet right now"
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
      "name": "withdrawalTooSmall",
      "msg": "Withdrawal below the minimum"
    },
    {
      "code": 6015,
      "name": "nothingToCheckpoint",
      "msg": "No loss or secured win to release"
    },
    {
      "code": 6016,
      "name": "staleRandomness",
      "msg": "Randomness does not answer the pending request"
    },
    {
      "code": 6017,
      "name": "invalidConfig",
      "msg": "Invalid configuration"
    },
    {
      "code": 6018,
      "name": "promoCapReached",
      "msg": "Promo payout above the pool's limits"
    },
    {
      "code": 6019,
      "name": "missingTable",
      "msg": "Blackjack needs the player's table account"
    },
    {
      "code": 6020,
      "name": "invalidTile",
      "msg": "Mines tile already revealed or off the board"
    },
    {
      "code": 6021,
      "name": "invalidChoice",
      "msg": "Choice outside the game's rules"
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
      "name": "coinSide",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "heads"
          },
          {
            "name": "tails"
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
              "Smallest stake, at least `MIN_BET_FLOOR`. Whatever a round gains, a win pays Tilt at",
              "least `MIN_FEE` (`settle`)."
            ],
            "type": "u64"
          },
          {
            "name": "maxBet",
            "docs": [
              "Largest stake of one bet, in USDC base units: a blackjack hand, a roulette chip (a",
              "`roulette_chips` spin stakes up to `MAX_CHIPS` of them), the bet of any other round."
            ],
            "type": "u64"
          },
          {
            "name": "maxRoundGain",
            "docs": [
              "Largest gain one round may produce (caps e.g. straight-up roulette and slot jackpots).",
              "Also the most one round can take from the risk pool (`risk::required_reserve`)."
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
              "A draw not answered this long can be requested again by the relayer."
            ],
            "type": "i64"
          },
          {
            "name": "abandonedRoundSecs",
            "docs": [
              "A round left waiting for the player this long (a blackjack hand, a Mines, Hilo or Tower",
              "board) is closed for them by the relayer: stand, or cash-out at the current value. Until",
              "then it holds its share of the risk pool and blocks `checkpoint`. At least",
              "`round_timeout_secs`."
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
          },
          {
            "name": "reveal"
          },
          {
            "name": "card"
          },
          {
            "name": "climb"
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
          },
          {
            "name": "mines"
          },
          {
            "name": "dice"
          },
          {
            "name": "limbo"
          },
          {
            "name": "flip"
          },
          {
            "name": "keno"
          },
          {
            "name": "wheel"
          },
          {
            "name": "hilo"
          },
          {
            "name": "tower"
          }
        ]
      }
    },
    {
      "name": "hiloBoard",
      "docs": [
        "The player's Hilo round. Lives in the rollup next to the player account; between rounds",
        "it keeps the last round for display."
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
            "type": "u64"
          },
          {
            "name": "maxGain",
            "docs": [
              "Most this round can gain, the cap on its gross return."
            ],
            "type": "u64"
          },
          {
            "name": "fair",
            "docs": [
              "Fair multiplier (×`FAIR_ONE`), before the house edge."
            ],
            "type": "u128"
          },
          {
            "name": "cards",
            "docs": [
              "Cards drawn, the first `n_cards` count."
            ],
            "type": {
              "array": [
                "u8",
                64
              ]
            }
          },
          {
            "name": "nCards",
            "type": "u8"
          },
          {
            "name": "guesses",
            "docs": [
              "`guesses[i]` (a `HiloMove` code) led to `cards[i + 1]`."
            ],
            "type": {
              "array": [
                "u8",
                63
              ]
            }
          },
          {
            "name": "nRight",
            "type": "u8"
          },
          {
            "name": "skips",
            "type": "u8"
          },
          {
            "name": "pending",
            "docs": [
              "The guess awaiting its card (`HiloMove` code), `NONE` otherwise."
            ],
            "type": "u8"
          },
          {
            "name": "busted",
            "docs": [
              "The last card proved the guess wrong."
            ],
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "hiloMove",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "higher"
          },
          {
            "name": "lower"
          },
          {
            "name": "skip"
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
            "name": "winReserved",
            "docs": [
              "House money reserved for the player's wins, moved from the risk pool's line when a",
              "withdrawal needs it; never decreases."
            ],
            "type": "u64"
          },
          {
            "name": "winReleased",
            "docs": [
              "Part of `win_reserved` given back to the house by `checkpoint` once the player lost",
              "it again; never decreases."
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
      "name": "minesBoard",
      "docs": [
        "The player's Mines round. Lives in the rollup next to the player account; between rounds",
        "it keeps the last round for display."
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
            "type": "u64"
          },
          {
            "name": "mines",
            "type": "u8"
          },
          {
            "name": "revealed",
            "docs": [
              "One bit per tile revealed safe (bit `tile`)."
            ],
            "type": "u32"
          },
          {
            "name": "order",
            "docs": [
              "Tiles revealed safe, in reveal order; the first `n_revealed` count."
            ],
            "type": {
              "array": [
                "u8",
                25
              ]
            }
          },
          {
            "name": "nRevealed",
            "type": "u8"
          },
          {
            "name": "pending",
            "docs": [
              "Tile awaiting its draw, `NONE` otherwise."
            ],
            "type": "u8"
          },
          {
            "name": "busted",
            "docs": [
              "The mine that ended the round, `NONE` otherwise."
            ],
            "type": "u8"
          },
          {
            "name": "maxGain",
            "docs": [
              "Most this round can gain (`max_gain`), the cap on its gross return."
            ],
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
            "name": "winReserved",
            "docs": [
              "House money moved from the risk pool to Solana for this player's wins (`secure_wins`,",
              "before a withdrawal); never decreases. Solana mirrors it in `Ledger::win_reserved`."
            ],
            "type": "u64"
          },
          {
            "name": "winReleased",
            "docs": [
              "Part of `win_reserved` given back to the house once lost again (`checkpoint`); never",
              "decreases."
            ],
            "type": "u64"
          },
          {
            "name": "uncovered",
            "docs": [
              "Net wins beyond the secured ones: the risk pool pays them until a withdrawal secures",
              "them (its share of `RiskPool::uncovered`)."
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
      "name": "pooled",
      "docs": [
        "What an open round puts on the pool: the part of its worst case the player's secured wins",
        "do not already cover (`gain`), and its stake. `gain` is at most `max_round_gain`."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "gain",
            "type": "u64"
          },
          {
            "name": "stake",
            "type": "u64"
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
      "name": "quickRound",
      "docs": [
        "A one-draw round: the player's choice, and the outcome once drawn (zeros before)."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "empty"
          },
          {
            "name": "dice",
            "fields": [
              {
                "name": "target",
                "type": "u16"
              },
              {
                "name": "over",
                "type": "bool"
              },
              {
                "name": "roll",
                "type": "u16"
              }
            ]
          },
          {
            "name": "limbo",
            "fields": [
              {
                "name": "target",
                "type": "u32"
              },
              {
                "name": "result",
                "type": "u32"
              }
            ]
          },
          {
            "name": "flip",
            "fields": [
              {
                "name": "side",
                "type": {
                  "defined": {
                    "name": "coinSide"
                  }
                }
              },
              {
                "name": "flips",
                "type": "u8"
              },
              {
                "name": "coins",
                "type": "u16"
              }
            ]
          },
          {
            "name": "keno",
            "fields": [
              {
                "name": "picks",
                "type": {
                  "array": [
                    "u8",
                    10
                  ]
                }
              },
              {
                "name": "nPicks",
                "type": "u8"
              },
              {
                "name": "drawn",
                "type": {
                  "array": [
                    "u8",
                    10
                  ]
                }
              }
            ]
          },
          {
            "name": "wheel",
            "fields": [
              {
                "name": "segments",
                "type": "u8"
              },
              {
                "name": "risk",
                "type": {
                  "defined": {
                    "name": "wheelRisk"
                  }
                }
              },
              {
                "name": "segment",
                "type": "u8"
              }
            ]
          }
        ]
      }
    },
    {
      "name": "quickTable",
      "docs": [
        "The player's last one-draw round, of any of the five games. Lives in the rollup next to",
        "the player account."
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
            "type": "u64"
          },
          {
            "name": "round",
            "type": {
              "defined": {
                "name": "quickRound"
              }
            }
          },
          {
            "name": "drawn",
            "docs": [
              "The outcome in `round` has been drawn."
            ],
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "riskPool",
      "docs": [
        "Lives in the rollup (delegated once), next to the player accounts. Every round that puts",
        "something on the pool reprices it at its start (`reprice`) and takes it off at its end",
        "(`close`): the bankroll it needed is free again at once."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "gains",
            "docs": [
              "Open rounds: Σ `gain`, Σ `stake` and Σ `gain × stake`."
            ],
            "type": "u128"
          },
          {
            "name": "stakes",
            "type": "u128"
          },
          {
            "name": "exposure",
            "type": "u128"
          },
          {
            "name": "uncovered",
            "docs": [
              "Players' net wins the pool pays and Solana has not secured yet (Σ their `uncovered`)."
            ],
            "type": "u64"
          },
          {
            "name": "transferred",
            "docs": [
              "Total moved from the pool to players' secured wins (`secure`); never decreases.",
              "Solana mirrors it in `Vault::pool_transferred`."
            ],
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
      "name": "rouletteChip",
      "docs": [
        "One chip of a `roulette_chips` spin: its own bet and amount."
      ],
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
            "name": "amount",
            "type": "u64"
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
      "name": "rouletteTable",
      "docs": [
        "The player's last `roulette_chips` spin: its chips, then the pocket once landed. Lives in",
        "the rollup next to the player account."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "player",
            "type": "pubkey"
          },
          {
            "name": "chips",
            "docs": [
              "The first `n_chips` count."
            ],
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "rouletteChip"
                  }
                },
                20
              ]
            }
          },
          {
            "name": "nChips",
            "type": "u8"
          },
          {
            "name": "pocket",
            "docs": [
              "0 to 36 once landed, `NO_POCKET` before."
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
          },
          {
            "name": "pooled",
            "docs": [
              "What the round puts on the risk pool until it settles."
            ],
            "type": {
              "defined": {
                "name": "pooled"
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
      "name": "towerBoard",
      "docs": [
        "The player's Tower round. Lives in the rollup next to the player account; between rounds",
        "it keeps the last round for display."
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
            "type": "u64"
          },
          {
            "name": "maxGain",
            "docs": [
              "Most this round can gain, the cap on its gross return."
            ],
            "type": "u64"
          },
          {
            "name": "difficulty",
            "type": {
              "defined": {
                "name": "towerDifficulty"
              }
            }
          },
          {
            "name": "climbed",
            "docs": [
              "The tile picked on each safe level; the first `level` count."
            ],
            "type": {
              "array": [
                "u8",
                9
              ]
            }
          },
          {
            "name": "level",
            "docs": [
              "Safe levels climbed."
            ],
            "type": "u8"
          },
          {
            "name": "pending",
            "docs": [
              "Tile awaiting its draw on level `level`, `NONE` otherwise."
            ],
            "type": "u8"
          },
          {
            "name": "busted",
            "docs": [
              "The tile that ended the round on level `level`, `NONE` otherwise."
            ],
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "towerDifficulty",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "easy"
          },
          {
            "name": "medium"
          },
          {
            "name": "hard"
          },
          {
            "name": "expert"
          },
          {
            "name": "master"
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
              "What the vault may owe in the worst case: for every player, deposited - forfeited -",
              "withdrawn_paid + their secured wins, plus what is left of the risk pool's line",
              "(pool_line - pool_transferred)."
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
          },
          {
            "name": "poolLine",
            "docs": [
              "Bankroll granted to the risk pool so far (`fund_risk_pool`), reserved; never decreases."
            ],
            "type": "u64"
          },
          {
            "name": "poolTransferred",
            "docs": [
              "Part of `pool_line` moved to players' secured wins (`Ledger::win_reserved`), as the",
              "rollup's `RiskPool::transferred` reports it; never decreases."
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "wheelRisk",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "low"
          },
          {
            "name": "medium"
          },
          {
            "name": "high"
          }
        ]
      }
    },
    {
      "name": "winsReleased",
      "docs": [
        "Secured wins the player lost again, back to the house."
      ],
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
            "name": "releasedTotal",
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
