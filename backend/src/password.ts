import { compare, hash } from 'bcryptjs'

// 迁移语义(spec 票 04):线上已有 $2a$/10 哈希原样可验;新哈希仅产生于空库 seed,同参数。
export const hashPassword = (plain: string) => hash(plain, 10)
export const verifyPassword = (plain: string, hashed: string) => compare(plain, hashed)
