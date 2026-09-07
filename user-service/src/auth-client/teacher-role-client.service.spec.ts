import { TeacherRoleClientService } from './teacher-role-client.service';

describe('TeacherRoleClientService', () => {
  let service: TeacherRoleClientService;
  const fetchMock = jest.fn();

  beforeEach(() => {
    jest.resetAllMocks();
    process.env.AUTH_SERVICE_URL = 'http://auth-microservice:3370';
    process.env.AUTH_SERVICE_TIMEOUT = '5000';
    process.env.AUTH_SERVICE_TOKEN = 'rs256-service-jwt';
    delete process.env.INTERNAL_SERVICE_TOKEN;
    global.fetch = fetchMock as unknown as typeof fetch;
    service = new TeacherRoleClientService();
  });

  it('posts to the scoped teacher grant endpoint with Bearer only', async () => {
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
    expect(init.headers.Authorization).toBe('Bearer rs256-service-jwt');
    expect(init.headers['x-internal-service-token']).toBeUndefined();
    expect(init.headers['x-service-name']).toBeUndefined();
    expect(result).toEqual({ granted: true });
  });

  it('throws when AUTH_SERVICE_TOKEN is unset', async () => {
    delete process.env.AUTH_SERVICE_TOKEN;

    await expect(service.grantTeacherRole('auth-1')).rejects.toThrow(/AUTH_SERVICE_TOKEN/);
    expect(fetchMock).not.toHaveBeenCalled();
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
