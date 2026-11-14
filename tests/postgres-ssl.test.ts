import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { PostgresDriver } from '../src/database/drivers/PostgresDriver';
import { DriverRegistry } from '../src/database/drivers/DriverRegistry';

describe('PostgresDriver SSL & CA Certificate Hardening', () => {
  let tmpDir: string;
  let certFilePath: string;
  const sampleCaPem = '-----BEGIN CERTIFICATE-----\nMIIB...SAMPLE_CA_CERTIFICATE...\n-----END CERTIFICATE-----';

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodestack-pg-ssl-test-'));
    certFilePath = path.join(tmpDir, 'custom-ca.pem');
    fs.writeFileSync(certFilePath, sampleCaPem, 'utf8');
  });

  afterAll(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it('should default rejectUnauthorized to true when ssl: true', async () => {
    const driver = new PostgresDriver({
      host: 'localhost',
      port: 5432,
      database: 'testdb',
      ssl: true,
    });

    expect(driver.getSslConfig()).toEqual({
      rejectUnauthorized: true,
    });
    expect(driver.getPool().options.ssl).toEqual({
      rejectUnauthorized: true,
    });
    await driver.close();
  });

  it('should default rejectUnauthorized to true when ssl is an empty object', async () => {
    const driver = new PostgresDriver({
      host: 'localhost',
      port: 5432,
      database: 'testdb',
      ssl: {},
    });

    expect(driver.getSslConfig()).toEqual({
      rejectUnauthorized: true,
    });
    expect(driver.getPool().options.ssl).toEqual({
      rejectUnauthorized: true,
    });
    await driver.close();
  });

  it('should allow explicitly setting rejectUnauthorized to false if user opts out', async () => {
    const driver = new PostgresDriver({
      host: 'localhost',
      port: 5432,
      database: 'testdb',
      ssl: { rejectUnauthorized: false },
    });

    expect(driver.getSslConfig()).toEqual({
      rejectUnauthorized: false,
    });
    expect(driver.getPool().options.ssl).toEqual({
      rejectUnauthorized: false,
    });
    await driver.close();
  });

  it('should support inline CA certificate string and default rejectUnauthorized to true', async () => {
    const driver = new PostgresDriver({
      host: 'localhost',
      port: 5432,
      database: 'testdb',
      ssl: true,
      ca: sampleCaPem,
    });

    expect(driver.getSslConfig()).toEqual({
      rejectUnauthorized: true,
      ca: sampleCaPem,
    });
    expect(driver.getPool().options.ssl).toEqual({
      rejectUnauthorized: true,
      ca: sampleCaPem,
    });
    await driver.close();
  });

  it('should automatically enable SSL with rejectUnauthorized: true when CA certificate is provided without explicit ssl: true', async () => {
    const driver = new PostgresDriver({
      host: 'localhost',
      port: 5432,
      database: 'testdb',
      ca: sampleCaPem,
    });

    expect(driver.getSslConfig()).toEqual({
      rejectUnauthorized: true,
      ca: sampleCaPem,
    });
    expect(driver.getPool().options.ssl).toEqual({
      rejectUnauthorized: true,
      ca: sampleCaPem,
    });
    await driver.close();
  });

  it('should support CA certificate as a file path and read its contents from disk', async () => {
    const driver = new PostgresDriver({
      host: 'localhost',
      port: 5432,
      database: 'testdb',
      ca: certFilePath,
    });

    expect(driver.getSslConfig()).toEqual({
      rejectUnauthorized: true,
      ca: sampleCaPem,
    });
    expect(driver.getPool().options.ssl).toEqual({
      rejectUnauthorized: true,
      ca: sampleCaPem,
    });
    await driver.close();
  });

  it('should support CA certificate specified inside options.ssl object as a file path', async () => {
    const driver = new PostgresDriver({
      host: 'localhost',
      port: 5432,
      database: 'testdb',
      ssl: { ca: certFilePath },
    });

    expect(driver.getSslConfig()).toEqual({
      rejectUnauthorized: true,
      ca: sampleCaPem,
    });
    expect(driver.getPool().options.ssl).toEqual({
      rejectUnauthorized: true,
      ca: sampleCaPem,
    });
    await driver.close();
  });

  it('should support Buffer CA certificate', async () => {
    const caBuf = Buffer.from(sampleCaPem, 'utf8');
    const driver = new PostgresDriver({
      host: 'localhost',
      port: 5432,
      database: 'testdb',
      ssl: true,
      ca: caBuf,
    });

    expect(driver.getSslConfig()).toEqual({
      rejectUnauthorized: true,
      ca: caBuf,
    });
    expect(driver.getPool().options.ssl).toEqual({
      rejectUnauthorized: true,
      ca: caBuf,
    });
    await driver.close();
  });

  it('should parse and enforce rejectUnauthorized: true from connection string uri', async () => {
    const driver = new PostgresDriver('postgresql://postgres:postgres@localhost:5432/testdb?ssl=true');

    expect(driver.getSslConfig()).toEqual({
      rejectUnauthorized: true,
    });
    expect(driver.getPool().options.ssl).toEqual({
      rejectUnauthorized: true,
    });
    await driver.close();
  });

  it('should parse and enforce rejectUnauthorized: true from connection string uri with sslmode=require', async () => {
    const driver = new PostgresDriver('postgresql://postgres:postgres@localhost:5432/testdb?sslmode=require');

    expect(driver.getSslConfig()).toEqual({
      rejectUnauthorized: true,
    });
    expect(driver.getPool().options.ssl).toEqual({
      rejectUnauthorized: true,
    });
    await driver.close();
  });

  it('should support connectionString combined with CA certificate configuration without connectionString stripping CA', async () => {
    const driver = new PostgresDriver({
      connectionString: 'postgresql://postgres:postgres@localhost:5432/testdb?sslmode=require',
      ca: certFilePath,
    });

    expect(driver.getSslConfig()).toEqual({
      rejectUnauthorized: true,
      ca: sampleCaPem,
    });
    expect(driver.getPool().options.ssl).toEqual({
      rejectUnauthorized: true,
      ca: sampleCaPem,
    });
    await driver.close();
  });

  it('should propagate SSL and CA configuration to read replica pools', async () => {
    const driver = new PostgresDriver({
      host: 'localhost',
      port: 5432,
      database: 'testdb',
      ssl: true,
      ca: certFilePath,
      readReplicas: [
        'postgresql://replica1.internal:5432/testdb',
        'postgresql://replica2.internal:5432/testdb',
      ],
    });

    const replicaPools = driver.getReplicaPools();
    expect(replicaPools.length).toBe(2);
    expect(replicaPools[0].options.ssl).toEqual({
      rejectUnauthorized: true,
      ca: sampleCaPem,
    });
    expect(replicaPools[1].options.ssl).toEqual({
      rejectUnauthorized: true,
      ca: sampleCaPem,
    });
    await driver.close();
  });

  it('should integrate with DriverRegistry for postgres provider', async () => {
    const driver = (await DriverRegistry.createDriver({
      provider: 'postgres',
      host: 'localhost',
      port: 5432,
      database: 'testdb',
      ssl: true,
      ca: certFilePath,
    })) as PostgresDriver;

    expect(driver instanceof PostgresDriver).toBe(true);
    expect(driver.getSslConfig()).toEqual({
      rejectUnauthorized: true,
      ca: sampleCaPem,
    });
    expect(driver.getPool().options.ssl).toEqual({
      rejectUnauthorized: true,
      ca: sampleCaPem,
    });
    await driver.close();
  });

  it('should preserve SSL config when cloning driver', async () => {
    const driver = new PostgresDriver({
      host: 'localhost',
      port: 5432,
      database: 'testdb',
      ssl: true,
      ca: sampleCaPem,
    });

    const cloned = driver.clone();
    expect(cloned.getSslConfig()).toEqual({
      rejectUnauthorized: true,
      ca: sampleCaPem,
    });
    expect(cloned.getPool().options.ssl).toEqual({
      rejectUnauthorized: true,
      ca: sampleCaPem,
    });
    await driver.close();
    await cloned.close();
  });

  it('should leave SSL undefined when ssl is false or omitted without CA', async () => {
    const driverWithoutSsl = new PostgresDriver({
      host: 'localhost',
      port: 5432,
      database: 'testdb',
    });
    expect(driverWithoutSsl.getSslConfig()).toBeUndefined();
    expect(driverWithoutSsl.getPool().options.ssl).toBeUndefined();
    await driverWithoutSsl.close();

    const driverWithSslFalse = new PostgresDriver({
      host: 'localhost',
      port: 5432,
      database: 'testdb',
      ssl: false,
    });
    expect(driverWithSslFalse.getSslConfig()).toBeUndefined();
    expect(driverWithSslFalse.getPool().options.ssl).toBeUndefined();
    await driverWithSslFalse.close();
  });
});
