import { describe, it, expect } from 'vitest';
import { loadDriverPackage } from '../src/database/drivers/DriverPackageLoader';
import { PostgresDriver } from '../src/database/drivers/PostgresDriver';
import { MssqlDriver } from '../src/database/drivers/MssqlDriver';

describe('DriverPackageLoader & Dynamic Driver Resolution', () => {
  it('should successfully resolve an installed package like pg', () => {
    const pg = loadDriverPackage('pg');
    expect(pg).toBeDefined();
    expect(typeof pg.Pool).toBe('function');
  });

  it('should throw MODULE_NOT_FOUND when loading a non-existent package', () => {
    expect(() => loadDriverPackage('non_existent_dummy_package_987654')).toThrow(/MODULE_NOT_FOUND/);
  });

  it('should surface helpful installation instructions in MssqlDriver when mssql is not installed', () => {
    expect(() => new MssqlDriver('mssql://sa:password@localhost:1433/testdb')).toThrow(
      "SQL Server driver requires the 'mssql' package. Install it via 'npm install mssql' in your project root or globally via 'npm install -g mssql'."
    );
  });

  it('should instantiate PostgresDriver with pg successfully', () => {
    const driver = new PostgresDriver({
      host: 'localhost',
      port: 5432,
      database: 'testdb',
      user: 'postgres',
      password: 'password',
    });
    expect(driver).toBeDefined();
    expect(driver.dialect.name).toBe('postgres');
  });
});
