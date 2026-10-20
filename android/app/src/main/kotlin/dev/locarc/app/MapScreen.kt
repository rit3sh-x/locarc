package dev.locarc.app

import android.os.Bundle
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import dev.locarc.core.BoardCodec
import dev.locarc.core.BoardItem
import dev.locarc.core.ReceiverState
import org.maplibre.android.MapLibre
import org.maplibre.android.camera.CameraPosition
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.MapView
import org.maplibre.android.maps.Style
import org.maplibre.android.style.expressions.Expression
import org.maplibre.android.style.layers.CircleLayer
import org.maplibre.android.style.layers.FillLayer
import org.maplibre.android.style.layers.PropertyFactory
import org.maplibre.android.style.sources.GeoJsonSource
import org.maplibre.geojson.Feature
import org.maplibre.geojson.FeatureCollection
import org.maplibre.geojson.Point
import org.maplibre.geojson.Polygon
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

private const val STYLE = "https://tiles.openfreemap.org/styles/liberty"

/** This phone, the other Receivers and the latest located Emitters, with a list that mirrors it. */
@Composable
fun MapScreen(s: ReceiverState) {
    val raster = s.board?.rasterHz ?: s.rasterHz
    val items =
        remember(s.board) {
            s.board?.let { runCatching { BoardCodec.decode(it.items) }.getOrNull() }.orEmpty().filter {
                it.position != null &&
                    (it.missed ?: 3) < 3
            }
        }
    Column(Modifier.fillMaxSize()) {
        MapLibreView(s, items, Modifier.fillMaxWidth().height(360.dp))
        LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp)) {
            item {
                Text(
                    "Located Emitters (${items.size})",
                    style = MaterialTheme.typography.titleSmall,
                    modifier = Modifier.padding(vertical = 8.dp),
                )
            }
            items(items.sortedBy { it.position!!.radiusM }) { it ->
                val p = it.position!!
                Row(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                    Text("%.4f MHz".format(it.ch * raster / 1e6), fontFamily = FontFamily.Monospace, modifier = Modifier.weight(1f))
                    Text("±${p.radiusM.toInt()} m · ${(it.occupancy * 100).toInt()}%", fontFamily = FontFamily.Monospace)
                }
            }
            item {
                Text(
                    "Receivers (${s.fleet.size})",
                    style = MaterialTheme.typography.titleSmall,
                    modifier = Modifier.padding(vertical = 8.dp),
                )
            }
            items(s.fleet) { r ->
                Text("${r.name}${if (r.pinned) " · pinned" else ""}", modifier = Modifier.padding(vertical = 4.dp))
            }
        }
    }
}

@Composable
private fun MapLibreView(
    s: ReceiverState,
    items: List<BoardItem>,
    modifier: Modifier,
) {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val view =
        remember {
            // MapLibre must be initialised before any MapView exists.
            MapLibre.getInstance(context)
            MapView(context).apply {
                onCreate(Bundle())
                getMapAsync { map -> map.setStyle(Style.Builder().fromUri(STYLE)) }
            }
        }
    DisposableEffect(lifecycle) {
        val observer =
            LifecycleEventObserver { _, event ->
                when (event) {
                    Lifecycle.Event.ON_START -> view.onStart()
                    Lifecycle.Event.ON_RESUME -> view.onResume()
                    Lifecycle.Event.ON_PAUSE -> view.onPause()
                    Lifecycle.Event.ON_STOP -> view.onStop()
                    Lifecycle.Event.ON_DESTROY -> view.onDestroy()
                    else -> Unit
                }
            }
        lifecycle.addObserver(observer)
        onDispose {
            lifecycle.removeObserver(observer)
            view.onDestroy()
        }
    }
    AndroidView(factory = { view }, modifier = modifier, update = { v -> v.getMapAsync { map -> draw(map, s, items) } })
}

private fun draw(
    map: MapLibreMap,
    s: ReceiverState,
    items: List<BoardItem>,
) {
    val style = map.style ?: return
    val emitters = items.map { Feature.fromGeometry(Point.fromLngLat(it.position!!.lng, it.position!!.lat)) }
    val regions = items.map { Feature.fromGeometry(circle(it.position!!.lat, it.position!!.lng, it.position!!.radiusM)) }
    val receivers =
        s.fleet.map { r ->
            Feature.fromGeometry(Point.fromLngLat(r.lng, r.lat)).apply { addBooleanProperty("pinned", r.pinned) }
        }
    val me = listOfNotNull(s.position?.let { Feature.fromGeometry(Point.fromLngLat(it.lng, it.lat)) })

    fun source(
        id: String,
        features: List<Feature>,
    ) {
        val fc = FeatureCollection.fromFeatures(features)
        val existing = style.getSourceAs<GeoJsonSource>(id)
        if (existing != null) existing.setGeoJson(fc) else style.addSource(GeoJsonSource(id, fc))
    }
    source("regions", regions)
    source("emitters", emitters)
    source("receivers", receivers)
    source("me", me)
    if (style.getLayer("regions") == null) {
        style.addLayer(
            FillLayer("regions", "regions").withProperties(PropertyFactory.fillColor("#d9480f"), PropertyFactory.fillOpacity(0.15f)),
        )
        style.addLayer(
            CircleLayer("emitters", "emitters").withProperties(
                PropertyFactory.circleRadius(6f),
                PropertyFactory.circleColor("#d9480f"),
                PropertyFactory.circleStrokeColor("#ffffff"),
                PropertyFactory.circleStrokeWidth(2f),
            ),
        )
        style.addLayer(
            CircleLayer("receivers", "receivers").withProperties(
                PropertyFactory.circleRadius(7f),
                PropertyFactory.circleColor("#ffffff"),
                PropertyFactory.circleStrokeColor("#0b7a75"),
                PropertyFactory.circleStrokeWidth(
                    Expression.switchCase(Expression.get("pinned"), Expression.literal(4f), Expression.literal(2f)),
                ),
            ),
        )
        style.addLayer(CircleLayer("me", "me").withProperties(PropertyFactory.circleRadius(5f), PropertyFactory.circleColor("#1971c2")))
    }
    val center = s.position?.let { LatLng(it.lat, it.lng) } ?: s.fleet.firstOrNull()?.let { LatLng(it.lat, it.lng) }
    if (center != null && map.cameraPosition.zoom < 3) {
        map.cameraPosition =
            CameraPosition
                .Builder()
                .target(center)
                .zoom(13.0)
                .build()
    }
}

/** An uncertainty circle as a polygon. */
private fun circle(
    lat: Double,
    lng: Double,
    radiusM: Double,
    points: Int = 40,
): Polygon {
    val dLat = radiusM / 111_320
    val dLng = dLat / maxOf(0.01, cos(lat * PI / 180))
    val ring = (0..points).map { i -> Point.fromLngLat(lng + dLng * cos(2 * PI * i / points), lat + dLat * sin(2 * PI * i / points)) }
    return Polygon.fromLngLats(listOf(ring))
}
