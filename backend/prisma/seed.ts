import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  // Ensure the singleton settings row exists.
  await prisma.appSetting.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  });

  // Create the first admin only if there are no users yet.
  const count = await prisma.user.count();
  if (count === 0) {
    const username = process.env.SEED_ADMIN_USERNAME || 'admin';
    const password = process.env.SEED_ADMIN_PASSWORD || 'admin1234';
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.user.create({
      data: { username, passwordHash, role: Role.ADMIN, active: true },
    });
    console.log(`Seeded admin user "${username}" (change the password after first login).`);
  } else {
    console.log(`Users already exist (${count}); skipping admin seed.`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
