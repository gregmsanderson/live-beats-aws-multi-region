import Config

# config/runtime.exs is executed for all environments, including
# during releases. It is executed after compilation and before the
# system starts, so it is typically used to load production configuration
# and secrets from environment variables or elsewhere. Do not define
# any compile-time configuration in here, as it won't be applied.
# The block below contains prod specific runtime configuration.

if System.get_env("PHX_SERVER") && System.get_env("RELEASE_NAME") do
  config :live_beats, LiveBeatsWeb.Endpoint, server: true
end

# modified for AWS (when use CDK stack to create RDS it does not provide
# a connection string, but instead generates username, password etc in JSON. Could concat them
# but it's perhaps clearer/easier to provide them separately)
#if config_env() == :prod do
#  database_url =
#    System.get_env("DATABASE_URL") ||
#      raise """
#      environment variable DATABASE_URL is missing.
#      For example: ecto://USER:PASS@HOST/DATABASE
#      """
if config_env() == :prod do
  database_url = "postgres://#{System.get_env("DB_USERNAME")}:#{System.get_env("DB_PASSWORD")}@#{System.get_env("DB_HOST")}:#{System.get_env("DB_PORT")}/#{System.get_env("DB_NAME")}"

  replica_database_url = System.get_env("REPLICA_DATABASE_URL") || database_url

  host =
    System.get_env("PHX_HOST") ||
      raise """
      environment variable PHX_HOST is missing.
      This should be the hostname you are using e.g localhost or example.com
      """
  #host = System.get_env("PHX_HOST") || "example.com"

  ecto_ipv6? = System.get_env("ECTO_IPV6") == "true"

  # modified for AWS (no FLY_APP_NAME)
  app_name = "live-beats"

  config :live_beats, LiveBeats.Repo,
    # ssl: true,
    socket_options: if(ecto_ipv6?, do: [:inet6], else: []),
    url: database_url,
    pool_size: String.to_integer(System.get_env("POOL_SIZE") || "10")

  config :live_beats, LiveBeats.ReplicaRepo,
    # ssl: true,
    priv: "priv/repo",
    socket_options: if(ecto_ipv6?, do: [:inet6], else: []),
    url: replica_database_url,
    pool_size: String.to_integer(System.get_env("POOL_SIZE") || "10")

  secret_key_base =
    System.get_env("SECRET_KEY_BASE") ||
      raise """
      environment variable SECRET_KEY_BASE is missing.
      You can generate one by calling: mix phx.gen.secret
      """

  config :live_beats, LiveBeatsWeb.Endpoint,
    url: [scheme: "http", host: host],
    http: [
       # modified for AWS (assume VPC only uses IPv4)
      ip: {0, 0, 0, 0},
      port: String.to_integer(System.get_env("PORT") || "4000")
    ],
    secret_key_base: secret_key_base

  # modified for AWS (since if run same the image locally, need to serve .mp3s from http://localhost:4000, not http://localhost)
  # while production needs either 80 and http (i use plain ALB) *or* 443 and https (if have set up a domain with ACM)
  files_port = if host == "localhost", do: 4000, else: 80
  files_scheme = if host == "localhost", do: "http", else: "http"

  config :live_beats, :files,
    admin_usernames: ~w(chrismccord mrkurt),
    # modified for AWS (currently using ephemeral storage)
    uploads_dir: "/tmp",
    host: [scheme: files_scheme, host: host, port: files_port],
    server_ip: System.fetch_env!("LIVE_BEATS_SERVER_IP"),
    # modified for AWS (no .local)
    hostname: host,
    # modified for AWS (default VPC does not have IPv6 enabled)
    transport_opts: [inet6: false]

  config :live_beats, :github,
    client_id: System.fetch_env!("LIVE_BEATS_GITHUB_CLIENT_ID"),
    client_secret: System.fetch_env!("LIVE_BEATS_GITHUB_CLIENT_SECRET")

  # modified for AWS (not using service discovery or service connect with Cluster.Strategy.DNSPoll)
  config :libcluster,
    topologies: [
      ecs: [
        strategy: ClusterEcs.Strategy,
        config: [
          cluster: System.get_env("AWS_ECS_CLUSTER_NAME") || "",
          service_name: System.get_env("AWS_ECS_SERVICE_ARN") || "",
          region: System.get_env("AWS_ECS_CLUSTER_REGION") || "",
          app_prefix: app_name, # the bit before the @ in app-name@ip
          polling_interval: 20_000 # default is 5 seconds so adjust as needed
        ]
      ]
    ]
end
