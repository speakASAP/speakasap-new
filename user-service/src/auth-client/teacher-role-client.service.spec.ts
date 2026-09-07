import { TeacherRoleClientService } from './teacher-role-client.service';

describe('TeacherRoleClientService', () => {
  let service: TeacherRoleClientService;
  const fetchMock = jest.fn();

  beforeEach(() => {
    jest.resetAllMocks();
    process.env.AUTH_SERVICE_URL = 'http://auth-microservice:3370';
    process.env.AUTH_SERVICE_TIMEOUT = '5000';
    process.env.INTERNAL_SERVICE_TOKEN = 'test-internal-token';
    process.env.SERVICE_NAME = 'user-service';
    delete process.env.AUTH_SERVICE_TOKEN;
    global.fetch = fetchMock as unknown as typeof fetch;
    service = new TeacherRoleClientService();
  });

  it('posts to the scoped teacher grant endpoint with service identity headers', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ userId: 'auth-1', role: 'app:speakasap:teacher', granted: true }),
    });

    const result = await service.grantTeacherRole('auth-1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://auth-microservice:3370/internal/roles/speakasap/teacher/auth-1');
    expect(init.method).toBe('POST');
    expect(init.headers['x-internal-service-token']).toBe('test-internal-token');
    expect(init.headers['x-service-name']).toBe('user-service');
    expect(result).toEqual({ granted: true });
  });

  it('prefers Authorization Bearer when AUTH_SERVICE_TOKEN is set', async () => {
    process.env.AUTH_SERVICE_TOKEN = 'rs256-service-jwt';
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ userId: 'auth-1', role: 'app:speakasap:teacher', granted: true }),
    });

    await service.grantTeacherRole('auth-1');

    const headers = fetchMock.mock.calls[0][1].headers;
    expect(headers.Authorization).toBe('Bearer rs256-service-jwt');
    expect(headers['x-internal-service-token']).toBeUndefined();
  });

  it('reports granted:false when the role was already assigned', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ userId: 'auth-1', role: 'app:speakasap:teacher', granted: false }),
    });

    await expect(service.grantTeacherRole('auth-1')).resolves.toEqual({ granted: false });
  });

  /**
   * A failing grant must never pass silently: a teacher without the role cannot open the
   * teacher portal, and a quiet skip here is precisely the failure that went unnoticed
   * for six weeks. The caller decides whether to abort the batch; this client's job is to
   * make the failure impossible to miss.
   */
  it('throws with status and body when auth rejects the grant', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => '{"message":"Role not found"}',
    });

    await expect(service.grantTeacherRole('auth-1')).rejects.toThrow(/404/);
  });

  it('throws when auth is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(service.grantTeacherRole('auth-1')).rejects.toThrow(/ECONNREFUSED/);
  });

  it('url-encodes the user id', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ granted: true }),
    });

    await service.grantTeacherRole('auth/../admin');

    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://auth-microservice:3370/internal/roles/speakasap/teacher/auth%2F..%2Fadmin',
    );
  });
});
