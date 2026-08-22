import { compare, genSalt, hash } from 'bcryptjs'

// 迁移语义(spec 票 04):线上已有 $2a$/10 哈希原样可验;新哈希仅产生于空库 seed,同参数。
// bcryptjs v3 默认产 $2b$,前缀显式钉回 $2a$ 与线上 Java BCryptPasswordEncoder 同形
// (2a/2b 同算法同参数,互验兼容;issues/04「bcryptjs 默认即 $2a$」的预设实测不成立于 v3)。
export const hashPassword = async (plain: string) =>
  hash(plain, (await genSalt(10)).replace(/^\$2b\$/, '$2a$'))
export const verifyPassword = (plain: string, hashed: string) => compare(plain, hashed)
